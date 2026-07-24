import { supabase } from '@/lib/supabase';
import type { EntityId, TransactionAttachment } from '@/lib/types';

const BUCKET = 'receipts';

export async function fetchAttachmentsForTransaction(transactionId: number) {
  const { data, error } = await supabase
    .from('transaction_attachments')
    .select('*')
    .eq('transaction_id', transactionId)
    .order('created_at', { ascending: false });
  return { data: (data || []) as TransactionAttachment[], error };
}

export async function uploadTransactionAttachment(input: {
  transactionId: number;
  entityId: EntityId;
  file: File;
}) {
  const safeName = input.file.name.replace(/[^\w.\-]+/g, '_');
  const path = `${input.entityId}/${input.transactionId}/${Date.now()}-${safeName}`;

  const { error: uploadError } = await supabase.storage
    .from(BUCKET)
    .upload(path, input.file, {
      cacheControl: '3600',
      upsert: false,
      contentType: input.file.type || undefined,
    });

  if (uploadError) {
    return { data: null, error: uploadError };
  }

  const { data, error } = await supabase
    .from('transaction_attachments')
    .insert([
      {
        transaction_id: input.transactionId,
        entity_id: input.entityId,
        file_name: input.file.name,
        storage_path: path,
        mime_type: input.file.type || null,
        file_size: input.file.size,
      },
    ])
    .select('*')
    .single();

  if (error) {
    await supabase.storage.from(BUCKET).remove([path]);
    return { data: null, error };
  }

  return { data: data as TransactionAttachment, error: null };
}

export async function deleteTransactionAttachment(attachment: TransactionAttachment) {
  await supabase.storage.from(BUCKET).remove([attachment.storage_path]);
  return supabase.from('transaction_attachments').delete().eq('id', attachment.id);
}

export async function getAttachmentSignedUrl(storagePath: string) {
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(storagePath, 60 * 10);
  return { url: data?.signedUrl ?? null, error };
}
