import { Controller, Get, Header, NotFoundException, Param, Query, StreamableFile } from '@nestjs/common';
import { createReadStream, existsSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { validPhotoPreviewSignature } from '../photos/photo-file-access';

// Uploaded filenames are unique (timestamp+random / UUID) and never rewritten,
// so far-future immutable caching is safe — a new upload always gets a new URL.
const IMMUTABLE_CACHE = 'public, max-age=31536000, immutable';

// Full/thumb files require a file-scoped admin preview signature. Public
// galleries use the token-checked /photos/:id endpoints. Logos remain public;
// originals are only served by the authenticated admin API.
const PUBLIC_PHOTO_VARIANTS = new Set(['full', 'thumb', 'logos']);

@Controller('uploads')
export class UploadsController {
  @Get('covers/:filename')
  @Header('Cache-Control', IMMUTABLE_CACHE)
  getCover(@Param('filename') filename: string) {
    const safeName = normalize(filename).replace(/^(\.\.[/\\])+/, '');
    const path = join(process.cwd(), 'uploads', 'covers', safeName);
    if (!existsSync(path)) throw new NotFoundException('文件不存在');
    return new StreamableFile(createReadStream(path), { type: this.contentType(path) });
  }

  @Get('photos/:tournamentId/:variant/:filename')
  @Header('Cache-Control', 'private, no-store')
  getPhoto(
    @Param('tournamentId') tournamentId: string,
    @Param('variant') variant: string,
    @Param('filename') filename: string,
    @Query('expires') expires?: string,
    @Query('signature') signature?: string,
  ) {
    if (!PUBLIC_PHOTO_VARIANTS.has(variant)) throw new NotFoundException('文件不存在');
    const safeTid = normalize(tournamentId).replace(/[/\\]/g, '');
    const safeName = normalize(filename).replace(/^(\.\.[/\\])+/, '').replace(/[/\\]/g, '');
    if (variant !== 'logos' && !validPhotoPreviewSignature(
      `photos/${safeTid}/${variant}/${safeName}`, expires, signature,
    )) throw new NotFoundException('文件不存在');
    const path = join(process.cwd(), 'uploads', 'photos', safeTid, variant, safeName);
    if (!existsSync(path)) throw new NotFoundException('文件不存在');
    return new StreamableFile(createReadStream(path), { type: this.contentType(path) });
  }

  private contentType(path: string) {
    const ext = extname(path).toLowerCase();
    if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
    if (ext === '.png') return 'image/png';
    if (ext === '.webp') return 'image/webp';
    if (ext === '.gif') return 'image/gif';
    if (ext === '.svg') return 'image/svg+xml';
    return 'application/octet-stream';
  }
}
