-- 검색 기록 테이블
CREATE TABLE IF NOT EXISTS search_logs (
  id           BIGSERIAL PRIMARY KEY,
  barcode      VARCHAR(20) NOT NULL,
  product_name VARCHAR(300),
  product_image TEXT,
  searched_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_search_logs_searched_at ON search_logs(searched_at DESC);
CREATE INDEX IF NOT EXISTS idx_search_logs_barcode ON search_logs(barcode);

-- 제품 등록 신청 테이블
CREATE TABLE IF NOT EXISTS product_requests (
  id           BIGSERIAL PRIMARY KEY,
  barcode      VARCHAR(20) NOT NULL,
  image_data   TEXT,
  status       VARCHAR(20) DEFAULT 'pending',
  submitted_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_product_requests_barcode ON product_requests(barcode);
CREATE INDEX IF NOT EXISTS idx_product_requests_status ON product_requests(status);
