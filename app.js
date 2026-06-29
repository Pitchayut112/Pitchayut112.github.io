// ============================================
// LIVE BOOKING — main app logic
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
  viewDate: new Date(),          // เดือนที่กำลังดูอยู่
  customer: null,                // { id, display_name, color } ถ้าล็อกอินแล้ว
  bookingsCache: new Map(),      // "YYYY-MM-DD" -> { display_name, is_mine } | { is_booked:true }
  pendingDate: null,             // วันที่กำลังจะจอง (รอ confirm ใน modal)
};

const WEEKDAYS = ["อา", "จ", "อ", "พ", "พฤ", "ศ", "ส"];
const MONTH_NAMES = [
  "มกราคม","กุมภาพันธ์","มีนาคม","เมษายน","พฤษภาคม","มิถุนายน",
  "กรกฎาคม","สิงหาคม","กันยายน","ตุลาคม","พฤศจิกายน","ธันวาคม"
];

function pad2(n) { return String(n).padStart(2, "0"); }
function fmtDate(d) { return `${d.getFullYear()}-${pad2(d.getMonth()+1)}-${pad2(d.getDate())}`; }
function todayStr() { return fmtDate(new Date()); }

function loadSession() {
  try {
    const raw = localStorage.getItem("lb_customer");
    if (raw) state.customer = JSON.parse(raw);
  } catch (e) { /* ignore */ }
}
function saveSession(customer) {
  state.customer = customer;
  if (customer) localStorage.setItem("lb_customer", JSON.stringify(customer));
  else localStorage.removeItem("lb_customer");
}

// ---------- Top bar render ----------
function renderTopbar() {
  const right = document.getElementById("topbarRight");
  if (state.customer) {
    right.innerHTML = `
      <span class="who-badge">
        <span class="swatch" style="background:${state.customer.color}"></span>
        ${escapeHtml(state.customer.display_name)}
      </span>
      <button class="pill" id="logoutBtn">ออกจากระบบ</button>
    `;
    document.getElementById("logoutBtn").onclick = () => {
      saveSession(null);
      renderTopbar();
      loadMonth();
    };
  } else {
    right.innerHTML = `<button class="pill" id="loginOpenBtn">เข้าสู่ระบบลูกค้า</button>`;
    document.getElementById("loginOpenBtn").onclick = openLoginModal;
  }
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str ?? "";
  return div.innerHTML;
}

// ---------- Calendar render ----------
function monthBounds(d) {
  const start = new Date(d.getFullYear(), d.getMonth(), 1);
  const end = new Date(d.getFullYear(), d.getMonth() + 1, 0);
  return { start, end };
}

async function loadMonth() {
  const { start, end } = monthBounds(state.viewDate);
  const startStr = fmtDate(start);
  const endStr = fmtDate(end);

  document.getElementById("monthLabel").textContent =
    `${MONTH_NAMES[state.viewDate.getMonth()]} ${state.viewDate.getFullYear() + 543}`;

  state.bookingsCache.clear();

  try {
    if (state.customer) {
      const { data, error } = await getSupabase().rpc("get_customer_view_bookings", {
        p_start: startStr, p_end: endStr, p_customer_id: state.customer.id
      });
      if (error) throw error;
      (data || []).forEach(row => {
        state.bookingsCache.set(row.booking_date, {
          display_name: row.display_name, is_mine: row.is_mine
        });
      });
    } else {
      const { data, error } = await getSupabase().rpc("get_public_bookings", {
        p_start: startStr, p_end: endStr
      });
      if (error) throw error;
      (data || []).forEach(row => {
        state.bookingsCache.set(row.booking_date, { is_booked: true });
      });
    }
  } catch (e) {
    console.error(e);
    showToast("โหลดข้อมูลปฏิทินไม่สำเร็จ ลองรีเฟรชหน้าใหม่", "err");
  }

  renderGrid();
}

function renderGrid() {
  const { start, end } = monthBounds(state.viewDate);
  const grid = document.getElementById("calGrid");
  grid.innerHTML = "";

  const leadingBlanks = start.getDay(); // 0=Sun
  for (let i = 0; i < leadingBlanks; i++) {
    const div = document.createElement("div");
    div.className = "day-cell empty";
    grid.appendChild(div);
  }

  const today = todayStr();

  for (let day = 1; day <= end.getDate(); day++) {
    const d = new Date(state.viewDate.getFullYear(), state.viewDate.getMonth(), day);
    const dStr = fmtDate(d);
    const cell = document.createElement("div");
    cell.className = "day-cell";

    const isPast = dStr < today;
    const booking = state.bookingsCache.get(dStr);
    const isFree = !booking;

    if (dStr === today) cell.classList.add("is-today");
    if (isPast) cell.classList.add("past");
    if (isFree && !isPast) cell.classList.add("free", "selectable");

    let tagHtml = "";
    if (booking) {
      cell.classList.add("has-booking");
      if (booking.is_booked) {
        tagHtml = `<span class="tag booked-tag">จองแล้ว</span>`;
      } else if (booking.is_mine) {
        cell.classList.add("is-mine");
        tagHtml = `<span class="tag mine">${escapeHtml(booking.display_name)}</span>`;
      } else {
        tagHtml = `<span class="tag booked-tag blur-name">${escapeHtml(booking.display_name)}</span>`;
      }
    } else if (!isPast) {
      tagHtml = `<span class="tag free-tag">ว่าง</span>`;
    }

    cell.innerHTML = `<span class="num">${day}</span>${tagHtml}`;

    if (isFree && !isPast) {
      cell.onclick = () => onPickDate(dStr);
    }

    grid.appendChild(cell);
  }
}

function onPickDate(dStr) {
  if (!state.customer) {
    showToast("กรุณาเข้าสู่ระบบก่อนทำการจองคิว", "err");
    openLoginModal();
    return;
  }
  state.pendingDate = dStr;
  document.getElementById("confirmDateLabel").textContent = formatThaiDate(dStr);
  document.getElementById("bookingNote").value = "";
  document.getElementById("confirmModal").classList.remove("hidden");
}

function formatThaiDate(dStr) {
  const [y, m, d] = dStr.split("-").map(Number);
  return `${d} ${MONTH_NAMES[m-1]} ${y + 543}`;
}

async function confirmBooking() {
  const note = document.getElementById("bookingNote").value.trim();
  const btn = document.getElementById("confirmBookBtn");
  btn.disabled = true;
  btn.textContent = "กำลังจอง...";

  try {
    const { data, error } = await getSupabase().rpc("create_booking", {
      p_customer_id: state.customer.id,
      p_date: state.pendingDate,
      p_note: note || null
    });
    if (error) throw error;
    const result = data && data[0];
    if (result && result.success) {
      showToast(result.message, "ok");
      closeConfirmModal();
      loadMonth();
    } else {
      showToast(result ? result.message : "จองไม่สำเร็จ", "err");
      loadMonth(); // โหลดใหม่เผื่อมีคนจองตัดหน้าไปแล้ว
    }
  } catch (e) {
    console.error(e);
    showToast("เกิดข้อผิดพลาด ลองใหม่อีกครั้ง", "err");
  } finally {
    btn.disabled = false;
    btn.textContent = "ยืนยันการจอง";
  }
}

function closeConfirmModal() {
  document.getElementById("confirmModal").classList.add("hidden");
  state.pendingDate = null;
}

// ---------- Login modal ----------
function openLoginModal() {
  document.getElementById("loginError").classList.add("hidden");
  document.getElementById("loginUsername").value = "";
  document.getElementById("loginPassword").value = "";
  document.getElementById("loginModal").classList.remove("hidden");
}
function closeLoginModal() {
  document.getElementById("loginModal").classList.add("hidden");
}

async function doLogin() {
  const username = document.getElementById("loginUsername").value.trim();
  const password = document.getElementById("loginPassword").value;
  const errEl = document.getElementById("loginError");
  const btn = document.getElementById("loginSubmitBtn");

  if (!username || !password) {
    errEl.textContent = "กรุณากรอกชื่อผู้ใช้และรหัสผ่าน";
    errEl.classList.remove("hidden");
    return;
  }

  btn.disabled = true;
  btn.textContent = "กำลังเข้าสู่ระบบ...";

  try {
    const { data, error } = await getSupabase().rpc("login_customer", {
      p_username: username, p_password: password
    });
    if (error) throw error;
    if (data && data.length > 0) {
      saveSession(data[0]);
      closeLoginModal();
      renderTopbar();
      loadMonth();
      showToast(`เข้าสู่ระบบสำเร็จ ยินดีต้อนรับ ${data[0].display_name}`, "ok");
    } else {
      errEl.textContent = "ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง";
      errEl.classList.remove("hidden");
    }
  } catch (e) {
    console.error(e);
    errEl.textContent = "เกิดข้อผิดพลาด ลองใหม่อีกครั้ง";
    errEl.classList.remove("hidden");
  } finally {
    btn.disabled = false;
    btn.textContent = "เข้าสู่ระบบ";
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

// ---------- Month nav ----------
function changeMonth(delta) {
  state.viewDate = new Date(state.viewDate.getFullYear(), state.viewDate.getMonth() + delta, 1);
  loadMonth();
}

// ---------- Init ----------
function init() {
  loadSession();
  renderTopbar();
  loadMonth();

  document.getElementById("prevMonthBtn").onclick = () => changeMonth(-1);
  document.getElementById("nextMonthBtn").onclick = () => changeMonth(1);

  document.getElementById("loginCancelBtn").onclick = closeLoginModal;
  document.getElementById("loginSubmitBtn").onclick = doLogin;
  document.getElementById("loginPassword").addEventListener("keydown", e => {
    if (e.key === "Enter") doLogin();
  });

  document.getElementById("confirmCancelBtn").onclick = closeConfirmModal;
  document.getElementById("confirmBookBtn").onclick = confirmBooking;
}

document.addEventListener("DOMContentLoaded", init);
