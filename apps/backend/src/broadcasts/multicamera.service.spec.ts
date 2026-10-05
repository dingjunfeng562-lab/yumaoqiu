import { MulticameraService } from './multicamera.service';
import { PrismaService } from '../prisma/prisma.service';
import { LivekitMediaService } from './livekit-media.service';
import { BroadcastsService } from './broadcasts.service';
import { Prisma } from '@prisma/client';

describe('multicamera media cleanup', () => {
  it('revokes camera credentials during an outage and reconciles the ended room after recovery', async () => {
    const revoke = jest.fn().mockResolvedValue({ count: 2 });
    const prisma = {
      broadcastSession: {
        findUnique: jest.fn().mockResolvedValue({ id: 'ended', liveRoomName: 'media-ended', enabled: true, status: 'ENDED' }),
        findMany: jest.fn().mockResolvedValue([{ id: 'ended' }]),
      },
      broadcastCamera: { updateMany: revoke },
      broadcastJoinInvite: { deleteMany: jest.fn().mockResolvedValue({ count: 1 }) },
    };
    const media = {
      configured: () => true,
      call: jest.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue({}),
      rooms: jest.fn().mockResolvedValue([{ name: 'media-ended' }]),
    };
    const service = new MulticameraService(prisma as unknown as PrismaService,
      media as unknown as LivekitMediaService, {} as BroadcastsService);
    await expect(service.closeMedia('ended')).rejects.toThrow('offline');
    expect(revoke).toHaveBeenCalledWith({ where: { broadcastId: 'ended' }, data: {
      tokenHash: null, pairingHash: null, pairingExpiresAt: null,
      deviceId: null, lastSeenAt: null, state: Prisma.DbNull,
    } });
    await (service as unknown as { reconcile(): Promise<void> }).reconcile();
    expect(prisma.broadcastSession.findMany.mock.calls[0][0].where.OR).toContainEqual({ liveRoomName: { in: ['media-ended'] } });
    expect(media.call).toHaveBeenNthCalledWith(2, 'DeleteRoom', 'media-ended');
    expect(media.call).toHaveBeenCalledTimes(2);
  });
});
