-- 제품 마스터 테이블
CREATE TABLE IF NOT EXISTS products (
  barcode        VARCHAR(20) PRIMARY KEY,
  name           VARCHAR(300) NOT NULL,
  brand          VARCHAR(100),
  category       VARCHAR(100),
  image_url      TEXT,
  created_at     TIMESTAMPTZ DEFAULT NOW(),
  updated_at     TIMESTAMPTZ DEFAULT NOW()
);

-- 가격 스냅샷 테이블
CREATE TABLE IF NOT EXISTS price_snapshots (
  id             BIGSERIAL PRIMARY KEY,
  barcode        VARCHAR(20) NOT NULL REFERENCES products(barcode) ON DELETE CASCADE,
  platform       VARCHAR(20) NOT NULL CHECK (platform IN ('naver', 'coupang', '11st', 'gmarket', 'auction')),
  price          INTEGER NOT NULL,
  original_price INTEGER,
  discount_rate  SMALLINT,
  url            TEXT NOT NULL,
  seller_name    VARCHAR(200),
  in_stock       BOOLEAN DEFAULT true,
  fetched_at     TIMESTAMPTZ DEFAULT NOW()
);

-- 인덱스
CREATE INDEX IF NOT EXISTS idx_price_snapshots_barcode ON price_snapshots(barcode);
CREATE INDEX IF NOT EXISTS idx_price_snapshots_fetched_at ON price_snapshots(fetched_at DESC);
CREATE INDEX IF NOT EXISTS idx_price_snapshots_barcode_platform ON price_snapshots(barcode, platform, fetched_at DESC);
CREATE INDEX IF NOT EXISTS idx_products_name ON products USING GIN(to_tsvector('simple', name));

-- updated_at 자동 갱신 트리거
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER products_updated_at
  BEFORE UPDATE ON products
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- 최신 가격만 조회하는 뷰 (플랫폼별 최근 1시간 이내)
CREATE OR REPLACE VIEW latest_prices AS
SELECT DISTINCT ON (barcode, platform)
  id, barcode, platform, price, original_price, discount_rate,
  url, seller_name, in_stock, fetched_at
FROM price_snapshots
WHERE fetched_at > NOW() - INTERVAL '1 hour'
ORDER BY barcode, platform, fetched_at DESC;

-- RLS 설정 (공개 읽기, 서버만 쓰기)
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
ALTER TABLE price_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "products_public_read" ON products FOR SELECT USING (true);
CREATE POLICY "price_snapshots_public_read" ON price_snapshots FOR SELECT USING (true);

-- service_role 은 RLS bypass 이므로 서버에서 service_role key 사용
