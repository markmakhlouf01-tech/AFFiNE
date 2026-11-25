import {
  addAttachments,
  addSiblingAttachmentBlocks,
  AttachmentEmbedProvider,
} from '@blocksuite/affine/blocks/attachment';
import { AttachmentBlockModel } from '@blocksuite/affine/model';
import type { EditorHost } from '@blocksuite/affine/std';
import type { BlockModel } from '@blocksuite/affine/store';

const EXTENSIONS: Record<string, string> = {
  'video/mp4': 'mp4',
  'video/webm': 'webm',
  'video/quicktime': 'mov',
};

export async function fetchVideoToFile(
  url: string,
  filename = 'video'
): Promise<File | null> {
  const res = await fetch(url, { credentials: 'same-origin' });
  if (!res.ok) return null;
  const blob = await res.blob();
  const type = blob.type.startsWith('video/') ? blob.type : 'video/mp4';
  return new File([blob], `${filename}.${EXTENSIONS[type] ?? 'mp4'}`, {
    type,
  });
}

// Switches the new attachment blocks to their embedded view (a video player).
function embedAttachments(host: EditorHost, blockIds: string[]) {
  const embed = host.std.getOptional(AttachmentEmbedProvider);
  if (!embed) return;
  for (const id of blockIds) {
    const model = host.store.getBlock(id)?.model;
    if (model instanceof AttachmentBlockModel) {
      embed.convertTo(model);
    }
  }
}

export async function insertVideoNextTo(
  host: EditorHost,
  file: File,
  targetModel: BlockModel,
  place: 'before' | 'after'
) {
  const blockIds = await addSiblingAttachmentBlocks(
    host.std,
    [file],
    targetModel,
    place,
    true
  );
  embedAttachments(host, blockIds);
}

export async function insertVideoOnCanvas(
  host: EditorHost,
  file: File,
  point: [number, number]
) {
  const blockIds = await addAttachments(host.std, [file], point);
  embedAttachments(host, blockIds);
}
