'use client';

import { useEffect, useState } from 'react';
import { Loader2, Paperclip, Trash2, ExternalLink } from 'lucide-react';
import { useEntity } from '@/app/providers/entity-provider';
import {
  deleteTransactionAttachment,
  fetchAttachmentsForTransaction,
  getAttachmentSignedUrl,
  uploadTransactionAttachment,
} from '@/lib/queries/attachments';
import type { TransactionAttachment } from '@/lib/types';

export function ReceiptAttachments({
  transactionId,
}: {
  transactionId: number;
}) {
  const { entityId } = useEntity();
  const [items, setItems] = useState<TransactionAttachment[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);

  async function reload() {
    setLoading(true);
    const { data } = await fetchAttachmentsForTransaction(transactionId);
    setItems(data);
    setLoading(false);
  }

  useEffect(() => {
    void reload();
  }, [transactionId]);

  async function handleUpload(fileList: FileList | null) {
    if (!fileList?.length) return;
    setUploading(true);
    for (const file of Array.from(fileList)) {
      const { error } = await uploadTransactionAttachment({
        transactionId,
        entityId,
        file,
      });
      if (error) {
        alert(
          error.message?.includes('Bucket') || error.message?.includes('not found')
            ? 'Receipts storage is missing. Run migration 009 (or create a “receipts” bucket in Supabase).'
            : error.message || 'Upload failed.'
        );
        break;
      }
    }
    setUploading(false);
    await reload();
  }

  async function handleOpen(item: TransactionAttachment) {
    const { url, error } = await getAttachmentSignedUrl(item.storage_path);
    if (error || !url) {
      alert('Could not open file.');
      return;
    }
    window.open(url, '_blank', 'noopener,noreferrer');
  }

  async function handleDelete(item: TransactionAttachment) {
    if (!confirm(`Delete ${item.file_name}?`)) return;
    await deleteTransactionAttachment(item);
    await reload();
  }

  return (
    <div className="rounded-2xl border border-[var(--border)] p-4 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-bold uppercase tracking-wider text-[var(--text-muted)] flex items-center gap-2">
          <Paperclip size={14} /> Receipts & files
        </p>
        <label className="cursor-pointer rounded-lg bg-[var(--surface-subtle)] px-3 py-1.5 text-xs font-bold text-[var(--entity-accent)] touch-manipulation">
          {uploading ? 'Uploading…' : 'Add photo / file'}
          <input
            type="file"
            accept="image/*,.pdf,.png,.jpg,.jpeg,.heic,.webp"
            capture="environment"
            className="hidden"
            disabled={uploading}
            multiple
            onChange={(e) => {
              void handleUpload(e.target.files);
              e.target.value = '';
            }}
          />
        </label>
      </div>

      {loading ? (
        <div className="flex justify-center py-4">
          <Loader2 className="animate-spin text-[var(--text-muted)]" size={18} />
        </div>
      ) : items.length === 0 ? (
        <p className="text-xs text-[var(--text-muted)]">No attachments yet.</p>
      ) : (
        <ul className="space-y-2">
          {items.map((item) => (
            <li
              key={item.id}
              className="flex items-center justify-between gap-2 rounded-xl bg-[var(--surface-subtle)] px-3 py-2"
            >
              <button
                type="button"
                className="min-w-0 flex-1 truncate text-left text-sm font-bold text-[var(--text-primary)]"
                onClick={() => void handleOpen(item)}
              >
                {item.file_name}
              </button>
              <div className="flex shrink-0 gap-1">
                <button
                  type="button"
                  aria-label="Open"
                  className="rounded-lg p-2 text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                  onClick={() => void handleOpen(item)}
                >
                  <ExternalLink size={14} />
                </button>
                <button
                  type="button"
                  aria-label="Delete"
                  className="rounded-lg p-2 text-[var(--text-muted)] hover:text-red-500"
                  onClick={() => void handleDelete(item)}
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
