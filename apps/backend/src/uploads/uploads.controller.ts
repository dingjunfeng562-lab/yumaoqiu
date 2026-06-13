import { Controller, Get, Header, NotFoundException, Param, StreamableFile } from '@nestjs/common';
import { createReadStream, existsSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';

// Uploaded filenames are unique (timestamp+random / UUID) and never rewritten,
// so far-future immutable caching is safe — a new upload always gets a new URL.
const IMMUTABLE_CACHE = 'public, max-age=31536000, immutable';

// Photo variants that are safe to expose publicly: `full/` (high-res with the
// logo watermark baked in) and `thumb/` (400px grid version). The `original/`
// directory is intentionally NOT served here — un-watermarked originals are
// only reachable through the admin-guarded `/admin/photos/:id/original` API.
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
  @Header('Cache-Control', IMMUTABLE_CACHE)
  getPhoto(
    @Param('tournamentId') tournamentId: string,
    @Param('variant') variant: string,
    @Param('filename') filename: string,
  ) {
    if (!PUBLIC_PHOTO_VARIANTS.has(variant)) throw new NotFoundException('文件不存在');
    const safeTid = normalize(tournamentId).replace(/[/\\]/g, '');
    const safeName = normalize(filename).replace(/^(\.\.[/\\])+/, '').replace(/[/\\]/g, '');
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
