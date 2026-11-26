-- Embedding vectors for workspace knowledge search (previously data/rag-vectors.json).
-- Keyed by the chunk's content hash and the embedding model, so unchanged text is never re-embedded
-- and switching models keeps the old vectors until they are no longer needed.
CREATE TABLE IF NOT EXISTS rag_vector (
    hash VARCHAR(64) NOT NULL,
    model VARCHAR(200) NOT NULL,
    dims INT NOT NULL,
    embedding BYTEA NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (hash, model)
);
