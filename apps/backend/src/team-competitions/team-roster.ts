import { BadRequestException } from '@nestjs/common';

export function validateTeamRoster(players: Array<{ gender: string }>) {
  if (!players.length) {
    throw new BadRequestException('每队至少需要一名队员');
  }
}
