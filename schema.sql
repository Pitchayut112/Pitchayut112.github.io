-- ============================================
-- LIVE BOOKING SYSTEM - Supabase Schema
-- ============================================

-- 1) Table: customers (ลูกค้าที่จ้างไลฟ์)
create table if not exists customers (
  id uuid primary key default gen_random_uuid(),
  username text unique not null,
  password text not null,          -- เก็บรหัสผ่านแบบข้อความล้วน (เหมาะกับงานเล็ก ไม่ใช่ระดับ enterprise)
  display_name text not null,      -- ชื่อจริงที่จะโชว์ตอนล็อกอินแล้ว
  color text default '#3DDC97',    -- สีประจำตัวลูกค้า (โชว์บนปฏิทินตอนล็อกอิน)
  active boolean default true,     -- ปิดการใช้งานได้โดยไม่ต้องลบ
  created_at timestamptz default now()
);

-- 2) Table: bookings (การจองคิวไลฟ์ - 1 แถว = 1 วัน)
create table if not exists bookings (
  id uuid primary key default gen_random_uuid(),
  booking_date date not null unique,   -- unique = กันจองวันซ้ำกันทับกันที่ระดับ DB
  customer_id uuid not null references customers(id) on delete cascade,
  note text,
  created_at timestamptz default now()
);

create index if not exists idx_bookings_date on bookings(booking_date);

-- ============================================
-- Row Level Security
-- ============================================
alter table customers enable row level security;
alter table bookings enable row level security;

-- customers: ไม่อนุญาตให้ฝั่ง client อ่านตารางนี้ตรงๆเลย (เพื่อกันรหัสผ่านหลุด)
-- การล็อกอินและการดึงชื่อทำผ่าน RPC function ที่นิยามด้านล่างเท่านั้น (security definer)
create policy "no direct select customers" on customers
  for select using (false);

-- bookings: ให้ทุกคนเห็น "วันที่ + customer_id" ได้ (เพื่อรู้ว่าวันไหนว่าง/ไม่ว่าง)
-- แต่ชื่อจริงจะถูกซ่อนผ่าน view ด้านล่าง ไม่ดึง join ตรงจาก client
create policy "anyone can read bookings" on bookings
  for select using (true);

-- การ insert/update/delete bookings ทำผ่าน RPC function เท่านั้น (ป้องกันจองทับ + ตรวจรหัส)
create policy "no direct write bookings" on bookings
  for insert with check (false);
create policy "no direct update bookings" on bookings
  for update using (false);
create policy "no direct delete bookings" on bookings
  for delete using (false);

-- ============================================
-- RPC: เข้าสู่ระบบลูกค้า (คืน id+ชื่อ+สี ถ้ารหัสถูก)
-- ============================================
create or replace function login_customer(p_username text, p_password text)
returns table(id uuid, display_name text, color text)
language plpgsql
security definer
as $$
begin
  return query
  select c.id, c.display_name, c.color
  from customers c
  where c.username = p_username
    and c.password = p_password
    and c.active = true;
end;
$$;

-- ============================================
-- RPC: ดึงปฏิทินสาธารณะ (ไม่ล็อกอิน) - ไม่มีชื่อลูกค้า
-- ============================================
create or replace function get_public_bookings(p_start date, p_end date)
returns table(booking_date date, is_booked boolean)
language sql
security definer
as $$
  select b.booking_date, true as is_booked
  from bookings b
  where b.booking_date between p_start and p_end;
$$;

-- ============================================
-- RPC: ดึงปฏิทินสำหรับลูกค้าที่ล็อกอินแล้ว
-- เห็นชื่อตัวเองชัด คนอื่นเห็นเป็น "***" (เบลอที่ฝั่ง UI)
-- ============================================
create or replace function get_customer_view_bookings(p_start date, p_end date, p_customer_id uuid)
returns table(booking_date date, display_name text, is_mine boolean)
language plpgsql
security definer
as $$
begin
  return query
  select
    b.booking_date,
    case when b.customer_id = p_customer_id then c.display_name else '••••••' end as display_name,
    (b.customer_id = p_customer_id) as is_mine
  from bookings b
  join customers c on c.id = b.customer_id
  where b.booking_date between p_start and p_end;
end;
$$;

-- ============================================
-- RPC: จองคิว (ลูกค้าล็อกอินแล้วเรียกใช้)
-- กันชนกันด้วย unique constraint ที่ booking_date อยู่แล้ว
-- ============================================
create or replace function create_booking(p_customer_id uuid, p_date date, p_note text default null)
returns table(success boolean, message text)
language plpgsql
security definer
as $$
begin
  -- เช็คว่าลูกค้ายัง active อยู่ไหม
  if not exists (select 1 from customers where id = p_customer_id and active = true) then
    return query select false, 'บัญชีนี้ไม่สามารถใช้งานได้';
    return;
  end if;

  -- เช็คว่าไม่ใช่วันที่ผ่านมาแล้ว
  if p_date < current_date then
    return query select false, 'ไม่สามารถจองวันที่ผ่านมาแล้วได้';
    return;
  end if;

  begin
    insert into bookings(booking_date, customer_id, note)
    values (p_date, p_customer_id, p_note);
    return query select true, 'จองสำเร็จ';
  exception when unique_violation then
    return query select false, 'วันนี้ถูกจองไปแล้ว กรุณาเลือกวันอื่น';
  end;
end;
$$;

-- ============================================
-- RPC: สำหรับแอดมิน - ดูทุกอย่างชัดเจน (ใช้ admin key เช็คฝั่ง JS)
-- ============================================
create or replace function admin_get_all_bookings(p_start date, p_end date)
returns table(booking_id uuid, booking_date date, customer_id uuid, display_name text, username text, note text)
language sql
security definer
as $$
  select b.id, b.booking_date, b.customer_id, c.display_name, c.username, b.note
  from bookings b
  join customers c on c.id = b.customer_id
  where b.booking_date between p_start and p_end
  order by b.booking_date;
$$;

create or replace function admin_get_all_customers()
returns table(id uuid, username text, password text, display_name text, color text, active boolean)
language sql
security definer
as $$
  select id, username, password, display_name, color, active from customers order by created_at;
$$;

create or replace function admin_create_customer(p_username text, p_password text, p_display_name text, p_color text default '#3DDC97')
returns table(success boolean, message text)
language plpgsql
security definer
as $$
begin
  begin
    insert into customers(username, password, display_name, color)
    values (p_username, p_password, p_display_name, p_color);
    return query select true, 'เพิ่มลูกค้าสำเร็จ';
  exception when unique_violation then
    return query select false, 'username นี้ถูกใช้ไปแล้ว';
  end;
end;
$$;

create or replace function admin_update_customer(p_id uuid, p_username text, p_password text, p_display_name text, p_color text, p_active boolean)
returns table(success boolean, message text)
language plpgsql
security definer
as $$
begin
  begin
    update customers set
      username = p_username,
      password = p_password,
      display_name = p_display_name,
      color = p_color,
      active = p_active
    where id = p_id;
    return query select true, 'แก้ไขสำเร็จ';
  exception when unique_violation then
    return query select false, 'username นี้ถูกใช้ไปแล้ว';
  end;
end;
$$;

create or replace function admin_delete_customer(p_id uuid)
returns void
language sql
security definer
as $$
  delete from customers where id = p_id;
$$;

create or replace function admin_delete_booking(p_booking_id uuid)
returns void
language sql
security definer
as $$
  delete from bookings where id = p_booking_id;
$$;

create or replace function admin_update_booking(p_booking_id uuid, p_date date, p_customer_id uuid, p_note text)
returns table(success boolean, message text)
language plpgsql
security definer
as $$
begin
  begin
    update bookings set booking_date = p_date, customer_id = p_customer_id, note = p_note
    where id = p_booking_id;
    return query select true, 'แก้ไขสำเร็จ';
  exception when unique_violation then
    return query select false, 'วันที่นี้ถูกจองไปแล้ว';
  end;
end;
$$;

create or replace function admin_create_booking(p_customer_id uuid, p_date date, p_note text default null)
returns table(success boolean, message text)
language plpgsql
security definer
as $$
begin
  begin
    insert into bookings(booking_date, customer_id, note)
    values (p_date, p_customer_id, p_note);
    return query select true, 'เพิ่มคิวสำเร็จ';
  exception when unique_violation then
    return query select false, 'วันนี้ถูกจองไปแล้ว';
  end;
end;
$$;
