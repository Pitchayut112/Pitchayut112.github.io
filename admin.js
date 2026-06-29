// ============================================
// LIVE BOOKING — admin panel logic
// ============================================
let supabase;
function getSupabase() {
  if (!supabase) {
    if (!window.supabase) {
      throw new Error("ไลบรารี Supabase โหลดไม่สำเร็จ กรุณาตรวจสอบการเชื่อมต่ออินเทอร์เน็ตแล้วรีเฟรชหน้าใหม่");
    }
    supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  }
  return supabase;
}

const state = {
  viewDate: new Date(),
  customers: [],
  bookings: [],
  editingCustomerId: null,
  editingBookingId: null,
};

const MONTH_NAMES = [
  "มกราคม","กุมภาพันธ์","มีนาคม","เมษายน","พฤษภาคม","มิถุนายน",
  "กรกฎาคม","สิงหาคม","กันยายน","ตุลาคม","พฤศจิกายน","ธันวาคม"
];

function pad2(n) { return String(n).padStart(2, "0"); }
function fmtDate(d) { return `${d.getFullYear()}-${pad2(d.getMonth()+1)}-${pad2(d.getDate())}`; }
function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str ?? "";
  return div.innerHTML;
}
function formatThaiDate(dStr) {
  const [y, m, d] = dStr.split("-").map(Number);
  return `${d} ${MONTH_NAMES[m-1]} ${y + 543}`;
}

// ---------- Auth gate (admin password) ----------
function isAdminUnlocked() {
  return sessionStorage.getItem("lb_admin_ok") === "1";
}
function checkAdminPassword() {
  const input = document.getElementById("adminPassInput").value;
  const errEl = document.getElementById("adminPassError");
  if (input === ADMIN_PASSWORD) {
    sessionStorage.setItem("lb_admin_ok", "1");
    document.getElementById("gateScreen").classList.add("hidden");
    document.getElementById("adminScreen").classList.remove("hidden");
    bootAdmin();
  } else {
    errEl.classList.remove("hidden");
  }
}

// ---------- Toast ----------
let toastTimer = null;
function showToast(text, kind) {
  const el = document.getElementById("toast");
  el.textContent = text;
  el.className = `msg ${kind === "ok" ? "ok" : "err"}`;
  el.classList.remove("hidden");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add("hidden"), 4000);
}

// ---------- Load data ----------
async function loadCustomers() {
  try {
    const { data, error } = await getSupabase().rpc("admin_get_all_customers");
    if (error) throw error;
    state.customers = data || [];
    renderCustomerList();
    fillCustomerSelects();
  } catch (e) {
    console.error(e);
    showToast(e.message || "โหลดรายชื่อลูกค้าไม่สำเร็จ", "err");
  }
}

function monthBounds(d) {
  const start = new Date(d.getFullYear(), d.getMonth(), 1);
  const end = new Date(d.getFullYear(), d.getMonth() + 1, 0);
  return { start, end };
}

async function loadBookings() {
  const { start, end } = monthBounds(state.viewDate);
  document.getElementById("monthLabel").textContent =
    `${MONTH_NAMES[state.viewDate.getMonth()]} ${state.viewDate.getFullYear() + 543}`;

  try {
    const { data, error } = await getSupabase().rpc("admin_get_all_bookings", {
      p_start: fmtDate(start), p_end: fmtDate(end)
    });
    if (error) throw error;
    state.bookings = data || [];
    renderBookingList();
  } catch (e) {
    console.error(e);
    showToast(e.message || "โหลดรายการจองไม่สำเร็จ", "err");
  }
}

// ---------- Render: customer list ----------
function renderCustomerList() {
  const wrap = document.getElementById("customerList");
  if (state.customers.length === 0) {
    wrap.innerHTML = `<p style="color:var(--text-dim);font-size:14px">ยังไม่มีลูกค้าในระบบ เพิ่มลูกค้าคนแรกได้ที่ปุ่มด้านบน</p>`;
    return;
  }
  wrap.innerHTML = state.customers.map(c => `
    <div class="row-item">
      <div class="row-main">
        <span class="swatch-dot" style="background:${c.color}"></span>
        <div>
          <div class="row-title">${escapeHtml(c.display_name)} ${c.active ? "" : '<span class="tag booked-tag" style="margin-left:6px">ปิดใช้งาน</span>'}</div>
          <div class="row-sub">@${escapeHtml(c.username)}</div>
        </div>
      </div>
      <div class="row-actions">
        <button class="btn ghost" data-edit-customer="${c.id}">แก้ไข</button>
        <button class="btn ghost" data-delete-customer="${c.id}" style="color:var(--accent)">ลบ</button>
      </div>
    </div>
  `).join("");

  wrap.querySelectorAll("[data-edit-customer]").forEach(btn => {
    btn.onclick = () => openCustomerModal(btn.dataset.editCustomer);
  });
  wrap.querySelectorAll("[data-delete-customer]").forEach(btn => {
    btn.onclick = () => deleteCustomer(btn.dataset.deleteCustomer);
  });
}

function fillCustomerSelects() {
  const opts = state.customers
    .map(c => `<option value="${c.id}">${escapeHtml(c.display_name)} (@${escapeHtml(c.username)})</option>`)
    .join("");
  document.getElementById("bookingCustomerSelect").innerHTML =
    `<option value="">— เลือกลูกค้า —</option>` + opts;
}

// ---------- Render: booking list ----------
function renderBookingList() {
  const wrap = document.getElementById("bookingList");
  if (state.bookings.length === 0) {
    wrap.innerHTML = `<p style="color:var(--text-dim);font-size:14px">ไม่มีการจองในเดือนนี้</p>`;
    return;
  }
  wrap.innerHTML = state.bookings.map(b => `
    <div class="row-item">
      <div class="row-main">
        <div>
          <div class="row-title">${formatThaiDate(b.booking_date)}</div>
          <div class="row-sub">${escapeHtml(b.display_name)} (@${escapeHtml(b.username)})${b.note ? " · " + escapeHtml(b.note) : ""}</div>
        </div>
      </div>
      <div class="row-actions">
        <button class="btn ghost" data-edit-booking="${b.booking_id}">แก้ไข</button>
        <button class="btn ghost" data-delete-booking="${b.booking_id}" style="color:var(--accent)">ลบ</button>
      </div>
    </div>
  `).join("");

  wrap.querySelectorAll("[data-edit-booking]").forEach(btn => {
    btn.onclick = () => openBookingModal(btn.dataset.editBooking);
  });
  wrap.querySelectorAll("[data-delete-booking]").forEach(btn => {
    btn.onclick = () => deleteBooking(btn.dataset.deleteBooking);
  });
}

// ---------- Customer modal ----------
function openCustomerModal(customerId) {
  state.editingCustomerId = customerId || null;
  const c = customerId ? state.customers.find(x => x.id === customerId) : null;

  document.getElementById("customerModalTitle").textContent = c ? "แก้ไขลูกค้า" : "เพิ่มลูกค้าใหม่";
  document.getElementById("custUsername").value = c ? c.username : "";
  document.getElementById("custPassword").value = c ? c.password : "";
  document.getElementById("custDisplayName").value = c ? c.display_name : "";
  document.getElementById("custColor").value = c ? c.color : "#3DDC97";
  document.getElementById("custActive").checked = c ? c.active : true;
  document.getElementById("customerError").classList.add("hidden");
  document.getElementById("customerModal").classList.remove("hidden");
}
function closeCustomerModal() {
  document.getElementById("customerModal").classList.add("hidden");
  state.editingCustomerId = null;
}

async function saveCustomer() {
  const username = document.getElementById("custUsername").value.trim();
  const password = document.getElementById("custPassword").value;
  const displayName = document.getElementById("custDisplayName").value.trim();
  const color = document.getElementById("custColor").value;
  const active = document.getElementById("custActive").checked;
  const errEl = document.getElementById("customerError");

  if (!username || !password || !displayName) {
    errEl.textContent = "กรุณากรอกข้อมูลให้ครบทุกช่อง";
    errEl.classList.remove("hidden");
    return;
  }

  const btn = document.getElementById("customerSaveBtn");
  btn.disabled = true;
  btn.textContent = "กำลังบันทึก...";

  try {
    let res;
    if (state.editingCustomerId) {
      res = await getSupabase().rpc("admin_update_customer", {
        p_id: state.editingCustomerId, p_username: username, p_password: password,
        p_display_name: displayName, p_color: color, p_active: active
      });
    } else {
      res = await getSupabase().rpc("admin_create_customer", {
        p_username: username, p_password: password, p_display_name: displayName, p_color: color
      });
    }
    if (res.error) throw res.error;
    const result = res.data && res.data[0];
    if (result && result.success) {
      showToast(result.message, "ok");
      closeCustomerModal();
      loadCustomers();
    } else {
      errEl.textContent = result ? result.message : "บันทึกไม่สำเร็จ";
      errEl.classList.remove("hidden");
    }
  } catch (e) {
    console.error(e);
    errEl.textContent = "เกิดข้อผิดพลาด ลองใหม่อีกครั้ง";
    errEl.classList.remove("hidden");
  } finally {
    btn.disabled = false;
    btn.textContent = "บันทึก";
  }
}

async function deleteCustomer(id) {
  const c = state.customers.find(x => x.id === id);
  if (!confirm(`ลบลูกค้า "${c ? c.display_name : ""}" ใช่ไหม? การจองทั้งหมดของลูกค้านี้จะถูกลบไปด้วย`)) return;
  try {
    const { error } = await getSupabase().rpc("admin_delete_customer", { p_id: id });
    if (error) throw error;
    showToast("ลบลูกค้าสำเร็จ", "ok");
    loadCustomers();
    loadBookings();
  } catch (e) {
    console.error(e);
    showToast("ลบไม่สำเร็จ", "err");
  }
}

// ---------- Booking modal ----------
function openBookingModal(bookingId) {
  state.editingBookingId = bookingId || null;
  const b = bookingId ? state.bookings.find(x => x.booking_id === bookingId) : null;

  document.getElementById("bookingModalTitle").textContent = b ? "แก้ไขคิว" : "เพิ่มคิวใหม่";
  document.getElementById("bookingDateInput").value = b ? b.booking_date : "";
  document.getElementById("bookingCustomerSelect").value = b ? b.customer_id : "";
  document.getElementById("bookingNoteInput").value = b ? (b.note || "") : "";
  document.getElementById("bookingError").classList.add("hidden");
  document.getElementById("bookingModal").classList.remove("hidden");
}
function closeBookingModal() {
  document.getElementById("bookingModal").classList.add("hidden");
  state.editingBookingId = null;
}

async function saveBooking() {
  const date = document.getElementById("bookingDateInput").value;
  const customerId = document.getElementById("bookingCustomerSelect").value;
  const note = document.getElementById("bookingNoteInput").value.trim();
  const errEl = document.getElementById("bookingError");

  if (!date || !customerId) {
    errEl.textContent = "กรุณาเลือกวันที่และลูกค้า";
    errEl.classList.remove("hidden");
    return;
  }

  const btn = document.getElementById("bookingSaveBtn");
  btn.disabled = true;
  btn.textContent = "กำลังบันทึก...";

  try {
    let res;
    if (state.editingBookingId) {
      res = await getSupabase().rpc("admin_update_booking", {
        p_booking_id: state.editingBookingId, p_date: date, p_customer_id: customerId, p_note: note || null
      });
    } else {
      res = await getSupabase().rpc("admin_create_booking", {
        p_customer_id: customerId, p_date: date, p_note: note || null
      });
    }
    if (res.error) throw res.error;
    const result = res.data && res.data[0];
    if (result && result.success) {
      showToast(result.message, "ok");
      closeBookingModal();
      loadBookings();
    } else {
      errEl.textContent = result ? result.message : "บันทึกไม่สำเร็จ";
      errEl.classList.remove("hidden");
    }
  } catch (e) {
    console.error(e);
    errEl.textContent = "เกิดข้อผิดพลาด ลองใหม่อีกครั้ง";
    errEl.classList.remove("hidden");
  } finally {
    btn.disabled = false;
    btn.textContent = "บันทึก";
  }
}

async function deleteBooking(id) {
  if (!confirm("ลบการจองนี้ใช่ไหม?")) return;
  try {
    const { error } = await getSupabase().rpc("admin_delete_booking", { p_booking_id: id });
    if (error) throw error;
    showToast("ลบการจองสำเร็จ", "ok");
    loadBookings();
  } catch (e) {
    console.error(e);
    showToast("ลบไม่สำเร็จ", "err");
  }
}

// ---------- Month nav ----------
function changeMonth(delta) {
  state.viewDate = new Date(state.viewDate.getFullYear(), state.viewDate.getMonth() + delta, 1);
  loadBookings();
}

// ---------- Boot ----------
function bootAdmin() {
  loadCustomers();
  loadBookings();
}

function init() {
  if (isAdminUnlocked()) {
    document.getElementById("gateScreen").classList.add("hidden");
    document.getElementById("adminScreen").classList.remove("hidden");
    bootAdmin();
  }

  document.getElementById("adminUnlockBtn").onclick = checkAdminPassword;
  document.getElementById("adminPassInput").addEventListener("keydown", e => {
    if (e.key === "Enter") checkAdminPassword();
  });

  document.getElementById("addCustomerBtn").onclick = () => openCustomerModal(null);
  document.getElementById("customerCancelBtn").onclick = closeCustomerModal;
  document.getElementById("customerSaveBtn").onclick = saveCustomer;

  document.getElementById("addBookingBtn").onclick = () => openBookingModal(null);
  document.getElementById("bookingCancelBtn").onclick = closeBookingModal;
  document.getElementById("bookingSaveBtn").onclick = saveBooking;

  document.getElementById("prevMonthBtn").onclick = () => changeMonth(-1);
  document.getElementById("nextMonthBtn").onclick = () => changeMonth(1);

  document.getElementById("logoutAdminBtn").onclick = () => {
    sessionStorage.removeItem("lb_admin_ok");
    location.reload();
  };
}

window.addEventListener("error", (e) => {
  if (e.message && e.message.includes("Supabase")) {
    showToast(e.message, "err");
  }
});

document.addEventListener("DOMContentLoaded", init);
