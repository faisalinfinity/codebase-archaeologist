-- Phase 4: keyword and optional semantic retrieval over source chunks.
ALTER TABLE code_chunks ADD COLUMN embedding_model text;
ALTER TABLE code_chunks ADD COLUMN embedding_updated_at timestamptz;

CREATE INDEX code_chunks_search_idx ON code_chunks USING gin (to_tsvector('simple', content));
CREATE INDEX code_chunks_embedding_model_idx ON code_chunks (snapshot_id, embedding_model)
  WHERE embedding IS NOT NULL;
CREATE INDEX code_chunks_embedding_cosine_idx ON code_chunks USING hnsw (embedding vector_cosine_ops)
  WHERE embedding IS NOT NULL;
