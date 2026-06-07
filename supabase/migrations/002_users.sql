-- 사용자 테이블
CREATE TABLE IF NOT EXISTS users (
  id               BIGSERIAL PRIMARY KEY,
  email            VARCHAR(200) UNIQUE NOT NULL,
  name             VARCHAR(100),
  image            TEXT,
  provider         VARCHAR(20) DEFAULT 'kakao',
  provider_id      VARCHAR(100),
  tier             VARCHAR(20) DEFAULT 'free' CHECK (tier IN ('guest', 'free', 'donor')),
  daily_count      INTEGER DEFAULT 0,
  last_search_date DATE,
  last_login       TIMESTAMPTZ DEFAULT NOW(),
  created_at       TIMESTAMPTZ DEFAULT NOW()
);

-- 검색 횟수 초기화 함수 (날짜 바뀌면 리셋)
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
