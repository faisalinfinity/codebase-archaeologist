-- One active personal provider per user; keys remain ciphertext-only.
CREATE UNIQUE INDEX ai_provider_configs_user_uidx ON ai_provider_configs (user_id);
CREATE UNIQUE INDEX api_keys_user_uidx ON api_keys (user_id);
