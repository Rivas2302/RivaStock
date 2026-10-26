export type KnowledgeFormat = 'pdf' | 'docx' | 'txt' | 'md' | 'image' | 'editor';
export type KnowledgeStatus = 'draft' | 'in_review' | 'published' | 'archived' | 'deleting';
export type KnowledgeIndexStatus = 'not_indexed' | 'queued' | 'processing' | 'ready' | 'error' | 'excluded';
export type KnowledgeKind = 'file' | 'editor';
export type KnowledgeVersionSource = 'upload' | 'editor' | 'import' | 'restore';
export type KnowledgeExtractionStatus = 'pending' | 'done' | 'not_supported' | 'error';
export type KnowledgeSort = 'updated_desc' | 'updated_asc' | 'title_asc' | 'relevance';

export interface KnowledgeDocument {
  id: string;
  user_id: string;
  kind: KnowledgeKind;
  format: KnowledgeFormat;
  title: string;
  description: string;
  folder_id: string | null;
  category_id: string | null;
  status: KnowledgeStatus;
  rag_enabled: boolean;
  current_version_id: string | null;
  published_version_id: string | null;
  draft_content: Record<string, unknown> | null;
  draft_revision: number;
  draft_updated_at: string | null;
  search_text: string;
  index_status: KnowledgeIndexStatus;
  indexed_version_id: string | null;
  index_error: string | null;
  last_indexed_at: string | null;
  chunk_count: number;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
  published_at: string | null;
  archived_at: string | null;
}

export interface KnowledgeListItem extends Pick<KnowledgeDocument,
  'id' | 'kind' | 'format' | 'title' | 'description' | 'folder_id' | 'category_id' | 'status' |
  'rag_enabled' | 'index_status' | 'index_error' | 'current_version_id' | 'published_version_id' |
  'created_at' | 'updated_at' | 'published_at'> {
  has_unpublished_changes: boolean;
  tag_ids: string[];
  snippet: string | null;
}

export interface KnowledgeVersion {
  id: string;
  user_id: string;
  document_id: string;
  version_number: number;
  source: KnowledgeVersionSource;
  storage_path: string | null;
  original_filename: string | null;
  mime_type: string | null;
  file_size: number | null;
  content_json: Record<string, unknown> | null;
  content_markdown: string | null;
  extracted_text: string | null;
  extraction_status: KnowledgeExtractionStatus;
  page_count: number | null;
  content_hash: string;
  change_note: string;
  created_by: string | null;
  created_at: string;
}

export interface KnowledgeFolder {
  id: string;
  user_id: string;
  parent_id: string | null;
  name: string;
  position: number;
  created_at: string;
  updated_at: string;
}

export interface KnowledgeCategory {
  id: string;
  user_id: string;
  name: string;
  color: 'slate' | 'blue' | 'green' | 'amber' | 'red' | 'violet' | 'teal';
  created_at: string;
}

export interface KnowledgeTag {
  id: string;
  user_id: string;
  name: string;
  created_at: string;
}

export interface KnowledgeEvent {
  id: number;
  user_id: string;
  document_id: string | null;
  actor_uid: string | null;
  action: string;
  details: Record<string, unknown>;
  created_at: string;
}

export interface KnowledgeStats {
  documents: number;
  draft: number;
  in_review: number;
  published: number;
  archived: number;
  deleting: number;
  index_queued: number;
  index_processing: number;
  index_ready: number;
  index_error: number;
  available_to_ai: number;
  chunks: number;
  last_updated_at: string | null;
  last_indexed_at: string | null;
  storage_bytes: number;
  storage_limit_bytes: number;
}

export interface KnowledgeAdminDocument {
  id: string;
  title: string;
  format: KnowledgeFormat;
  status: KnowledgeStatus;
  rag_enabled: boolean;
  index_status: KnowledgeIndexStatus;
  index_error: string | null;
  chunk_count: number;
  last_indexed_at: string | null;
  updated_at: string;
}

export type KnowledgeIndexJobStatus = 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled';
export type KnowledgeIndexJobReason = 'publish' | 'rag_enabled' | 'reindex' | 'backfill';

export interface KnowledgeIndexJob {
  id: string;
  document_id: string;
  document_title: string | null;
  reason: KnowledgeIndexJobReason;
  status: KnowledgeIndexJobStatus;
  attempt_count: number;
  started_at: string | null;
  completed_at: string | null;
  error: string | null;
  stats: Record<string, unknown>;
  created_at: string;
}

export interface KnowledgeSearchFilters {
  query?: string;
  documentIds?: string[];
  folderIds?: string[];
  categoryIds?: string[];
  folderId?: string | null;
  includeSubfolders?: boolean;
  categoryId?: string | null;
  tagIds?: string[];
  formats?: KnowledgeFormat[];
  statuses?: KnowledgeStatus[];
  indexStatuses?: KnowledgeIndexStatus[];
  updatedFrom?: string | null;
  updatedTo?: string | null;
  sort?: KnowledgeSort;
  limit?: number;
  offset?: number;
}

export interface KnowledgeSearchResult {
  total: number;
  items: KnowledgeListItem[];
}
