create unique index if not exists products_sku_unique
  on public.products (sku);

create unique index if not exists suppliers_company_country_unique
  on public.suppliers (company_name, country);

create unique index if not exists purchase_order_lines_po_product_unique
  on public.purchase_order_lines (purchase_order_id, product_id);
