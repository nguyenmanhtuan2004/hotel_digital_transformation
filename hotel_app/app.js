/**
 * A26 Hotel PMS — Application Logic
 * Native integration with Azure Data API Builder (DAB) & Azure SQL
 */

let roomsData = [], channelsData = [], bookingsData = [], customersData = [], activeCheckoutId = null;

// Tự động nhận diện host API: DAB chạy tại localhost:5000/api hoặc Azure Static Web Apps (/data-api/rest)
const API_BASE = window.location.pathname.startsWith('/data-api') 
  ? '/data-api/rest' 
  : ((window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') && window.location.port !== '5000'
      ? 'http://localhost:5000/api'
      : (window.location.port === '5000' ? '/api' : 'http://localhost:5000/api'));

const formatVND = val => (Math.round(val || 0)).toLocaleString('vi-VN') + ' đ';

const formatDateTime = dtStr => {
  if (!dtStr) return '-';
  const d = new Date(dtStr);
  if (isNaN(d.getTime())) return dtStr;
  const pad = n => n < 10 ? '0' + n : n;
  const day = pad(d.getDate());
  const month = pad(d.getMonth() + 1);
  const year = String(d.getFullYear()).slice(-2);
  const hours = pad(d.getHours());
  const minutes = pad(d.getMinutes());
  return `${day}/${month}/${year} ${hours}:${minutes}`;
};

const formatEstimatedCheckout = (inTimeStr, nights) => {
  if (!inTimeStr || !nights) return '-';
  const d = new Date(inTimeStr);
  if (isNaN(d.getTime())) return '-';
  d.setDate(d.getDate() + nights);
  d.setHours(12, 0, 0, 0);
  const pad = n => n < 10 ? '0' + n : n;
  const day = pad(d.getDate());
  const month = pad(d.getMonth() + 1);
  const year = String(d.getFullYear()).slice(-2);
  return `${day}/${month}/${year} 12:00`;
};

function showToast(text) {
  const toast = document.getElementById('toast-msg');
  if (!toast) return;
  toast.innerText = text;
  toast.style.display = 'block';
  setTimeout(() => { toast.style.display = 'none'; }, 3500);
}

// Helper giải nén data trả về từ DAB (DAB bọc mảng kết quả trong object.value)
async function apiGet(entityPath) {
  const res = await fetch(`${API_BASE}/${entityPath}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
  const json = await res.json();
  return Array.isArray(json.value) ? json.value : (Array.isArray(json) ? json : (json.value || json));
}

// ─── Chuẩn hóa dữ liệu tương thích CSDL Azure SQL ───────
function normalizeRoom(r) {
  return {
    room_id: r.RoomID ?? r.room_id,
    room_number: r.RoomNumber ?? r.room_number,
    room_type: r.RoomType ?? r.room_type,
    floor: r.Floor ?? r.floor,
    base_price: Number(r.BasePrice ?? r.base_price ?? 0),
    status: (r.RoomStatus ?? r.Status ?? r.status ?? 'available').toLowerCase(),
    clean_status: (r.CleanStatus ?? r.clean_status ?? 'clean').toLowerCase(),
    last_cleaned_at: r.LastCleanedAt ?? r.last_cleaned_at,
    guest_name: r.GuestName ?? r.guest_name,
    booking_id: r.BookingID ?? r.booking_id,
    check_in_time: r.CheckInTime ?? r.check_in_time,
    check_out_time: r.CheckOutTime ?? r.check_out_time,
    balance_due: Number(r.BalanceDue ?? r.balance_due ?? 0)
  };
}

function normalizeChannel(c) {
  const comm = Number(c.CommissionRate ?? c.commission_rate ?? 0);
  return {
    channel_id: c.ChannelID ?? c.channel_id,
    channel_name: c.ChannelName ?? c.channel_name,
    channel_category: c.ChannelCategory ?? c.channel_category ?? 'Direct',
    commission_rate: comm > 1 ? (comm / 100) : comm
  };
}

function normalizeCustomer(c) {
  return {
    customer_id: c.CustomerID ?? c.customer_id,
    full_name: c.FullName ?? c.full_name,
    phone_number: c.PhoneNumber ?? c.phone_number,
    id_number: c.IdNumber ?? c.id_number,
    nationality: c.Nationality ?? c.nationality ?? 'Việt Nam'
  };
}

function normalizeBooking(b) {
  return {
    booking_id: b.BookingID ?? b.booking_id,
    customer_id: b.CustomerID ?? b.customer_id,
    customer_name: b.CustomerName ?? b.customer_name ?? b.FullName ?? b.full_name ?? '',
    customer_phone: b.CustomerPhone ?? b.customer_phone ?? b.PhoneNumber ?? b.phone_number ?? '',
    room_id: b.RoomID ?? b.room_id,
    room_number: b.RoomNumber ?? b.room_number ?? '',
    channel_id: b.ChannelID ?? b.channel_id,
    check_in_time: b.CheckInTime ?? b.check_in_time,
    check_out_time: b.CheckOutTime ?? b.check_out_time,
    nights: Number(b.Nights ?? b.nights ?? 1),
    room_revenue: Number(b.RoomRevenue ?? b.room_revenue ?? 0),
    avg_price: Number(b.AvgPrice ?? b.avg_price ?? 0),
    service_revenue: Number(b.ServiceRevenue ?? b.service_revenue ?? 0),
    gross_revenue: Number(b.GrossRevenue ?? b.gross_revenue ?? 0),
    commission_amount: Number(b.CommissionAmount ?? b.commission_amount ?? 0),
    net_revenue: Number(b.NetRevenue ?? b.net_revenue ?? 0),
    cash_amount: Number(b.CashAmount ?? b.cash_amount ?? 0),
    card_amount: Number(b.CardAmount ?? b.card_amount ?? 0),
    transfer_amount: Number(b.TransferAmount ?? b.transfer_amount ?? 0),
    debt_amount: Number(b.DebtAmount ?? b.debt_amount ?? 0),
    balance_due: Number(b.BalanceDue ?? b.balance_due ?? 0),
    booking_status: b.BookingStatus ?? b.booking_status ?? 'CHECKIN',
    created_at: b.CreatedAt ?? b.created_at,
    notes: b.Notes ?? b.notes ?? ''
  };
}

// ─── Khởi chạy ứng dụng ────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  // Live Clock
  setInterval(() => {
    const now = new Date();
    const timeEl = document.getElementById('live-time');
    if (timeEl) timeEl.innerText = now.toLocaleTimeString('vi-VN') + ' | ' + now.toLocaleDateString('vi-VN');
  }, 1000);

  resetCheckinForm();
  initAllData();
});

async function initAllData() {
  try {
    await Promise.all([
      fetchRooms(),
      fetchChannels(),
      fetchCustomers()
    ]);
    await fetchBookings();
    updateDashboardStats();
  } catch (err) {
    console.error("Lỗi đồng bộ dữ liệu ban đầu:", err);
  }
}

function switchNavTab(tabId) {
  document.querySelectorAll('.tab-pane').forEach(el => el.classList.remove('active'));
  document.querySelectorAll('.tab-item').forEach(el => el.classList.remove('active'));

  const target = document.getElementById(tabId);
  if (target) target.classList.add('active');

  const btn = Array.from(document.querySelectorAll('.tab-item')).find(b => {
    const onclick = b.getAttribute('onclick') || '';
    return onclick.includes(tabId);
  });
  if (btn) btn.classList.add('active');

  if (tabId === 'tab-customers') fetchCustomers();
  if (tabId === 'tab-rooms') fetchRooms();
  if (tabId === 'tab-bookings') fetchBookings();
  if (tabId === 'tab-channels') fetchChannels();
}

// ─── 1. Stats (Tính toán Realtime từ dữ liệu thật Azure SQL) ───
function updateDashboardStats() {
  try {
    const totalRooms = roomsData.length || 20;
    const occupiedRooms = roomsData.filter(r => r.status === 'occupied').length;
    const occRate = Math.round((occupiedRooms / totalRooms) * 100);

    const grossRevenue = bookingsData.reduce((sum, b) => sum + (b.gross_revenue || 0), 0);
    const netRevenue = bookingsData.reduce((sum, b) => sum + (b.net_revenue || 0), 0);
    const totalBookings = bookingsData.length;

    const grossEl = document.getElementById('kpi-gross');
    if (grossEl) grossEl.innerText = formatVND(grossRevenue);

    const netEl = document.getElementById('kpi-net');
    if (netEl) netEl.innerText = formatVND(netRevenue);

    const occEl = document.getElementById('kpi-occ');
    if (occEl) occEl.innerText = occRate + '%';

    const occRatioEl = document.getElementById('kpi-occ-ratio');
    if (occRatioEl) occRatioEl.innerText = `${occupiedRooms}/${totalRooms} phòng đang lưu trú`;

    const countEl = document.getElementById('kpi-count');
    if (countEl) countEl.innerText = totalBookings;
  } catch (err) {
    console.error("Stats error:", err);
  }
}

// ─── 2. Rooms (Gọi DAB: RoomStatusMatrix / DimRoom) ─────
async function fetchRooms() {
  try {
    let raw = [];
    try {
      raw = await apiGet('RoomStatusMatrix');
    } catch {
      raw = await apiGet('DimRoom');
    }
    roomsData = raw.map(normalizeRoom);

    const sel = document.getElementById('f-room');
    if (sel) {
      sel.innerHTML = '<option value="">-- Chọn phòng lưu trú --</option>' + roomsData.map(r => {
        const stText = r.status === 'available' ? 'Trống' : (r.status === 'occupied' ? 'Đang ở' : 'Đang dọn');
        return `<option value="${r.room_id}" ${r.status !== 'available' ? 'disabled' : ''}>P.${r.room_number} - ${r.room_type} (${formatVND(r.base_price)}/đêm) [${stText}]</option>`;
      }).join('');
    }

    filterRoomsList();
    updateDashboardStats();
  } catch (err) {
    console.error("Rooms fetch error:", err);
  }
}

function filterRoomsList() {
  const q = (document.getElementById('search-rooms')?.value || '').trim().toLowerCase();
  const st = (document.getElementById('filter-room-st')?.value) || 'all';

  const filtered = roomsData.filter(r => {
    const matchQ = !q || (
      (r.room_number || '') + ' ' +
      (r.room_type || '') + ' ' +
      ('tầng ' + (r.floor || '')) + ' ' +
      (r.base_price || '')
    ).toLowerCase().includes(q);

    const matchSt = (st === 'all') || (r.status === st);
    return matchQ && matchSt;
  });

  renderRoomsList(filtered);
}

function renderRoomsList(list) {
  const tbody = document.getElementById('tbody-rooms');
  if (!tbody) return;
  if (list.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" style="text-align: center; color: var(--text-muted); padding: 1.5rem;">Không tìm thấy phòng phù hợp</td></tr>';
    return;
  }

  tbody.innerHTML = list.map(r => {
    let badge = 'badge-available', text = 'Trống (Sẵn sàng)';
    if (r.status === 'occupied') { badge = 'badge-occupied'; text = 'Đang ở'; }
    if (r.status === 'cleaning') { badge = 'badge-cleaning'; text = 'Đang dọn'; }

    let action = '-';
    if (r.status === 'cleaning') {
      action = `<button class="btn btn-success btn-sm" onclick="updateRoomCleanAction(${r.room_id}, 'clean')">Đã dọn xong</button>`;
    } else if (r.status === 'available') {
      action = `<button class="btn btn-vinamilk btn-sm" onclick="quickSelectRoom(${r.room_id})">Check-in</button>`;
    }

    return `
      <tr>
        <td><strong style="font-family:'Be Vietnam Pro',sans-serif; color:var(--v-blue);">${r.room_number}</strong></td>
        <td>${r.room_type}</td>
        <td>Tầng ${r.floor}</td>
        <td><strong>${formatVND(r.base_price)}</strong></td>
        <td><span class="status-badge ${badge}">${text}</span></td>
        <td>${action}</td>
      </tr>
    `;
  }).join('');
}

function resetRoomsFilter() {
  if (document.getElementById('search-rooms')) document.getElementById('search-rooms').value = '';
  if (document.getElementById('filter-room-st')) document.getElementById('filter-room-st').value = 'all';
  filterRoomsList();
}

async function updateRoomCleanAction(roomId, cleanStatus) {
  try {
    const res = await fetch(`${API_BASE}/UpdateCleanStatus`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        RoomID: roomId,
        CleanStatus: cleanStatus
      })
    });
    if (res.ok) {
      showToast('Đã cập nhật buồng phòng thành công!');
      await initAllData();
    } else {
      showToast('Lỗi cập nhật buồng phòng');
    }
  } catch (err) {
    showToast(`Lỗi: ${err.message}`);
  }
}

function quickSelectRoom(roomId) {
  switchNavTab('tab-checkin');
  const fRoom = document.getElementById('f-room');
  if (fRoom) {
    fRoom.value = roomId;
    handleRoomSelect();
  }
}

// ─── 3. Channels (Gọi DAB: DimChannel) ─────────────────
async function fetchChannels() {
  try {
    const raw = await apiGet('DimChannel');
    channelsData = raw.map(normalizeChannel);

    const fChan = document.getElementById('f-chan');
    if (fChan) {
      fChan.innerHTML = channelsData.map(c => `
        <option value="${c.channel_id}">${c.channel_name} (${(c.commission_rate * 100).toFixed(0)}% hoa hồng)</option>
      `).join('');
    }

    filterChannelsList();
  } catch (err) {
    console.error("Channels error:", err);
  }
}

function filterChannelsList() {
  const q = (document.getElementById('search-channels')?.value || '').trim().toLowerCase();
  const cat = (document.getElementById('filter-chan-cat')?.value) || 'all';

  const filtered = channelsData.filter(c => {
    const matchQ = !q || (
      (c.channel_name || '') + ' ' +
      (c.channel_category || '') + ' ' +
      (c.channel_id || '')
    ).toLowerCase().includes(q);

    const matchCat = (cat === 'all') || (c.channel_category === cat);
    return matchQ && matchCat;
  });

  renderChannelsList(filtered);
}

function renderChannelsList(list) {
  const tbody = document.getElementById('tbody-channels');
  if (!tbody) return;
  if (list.length === 0) {
    tbody.innerHTML = '<tr><td colspan="4" style="text-align: center; color: var(--text-muted); padding: 1.5rem;">Không tìm thấy kênh phân phối phù hợp</td></tr>';
    return;
  }

  tbody.innerHTML = list.map(c => `
    <tr>
      <td>${c.channel_id}</td>
      <td><strong>${c.channel_name}</strong></td>
      <td><span class="status-badge ${c.channel_category === 'OTA' ? 'badge-occupied' : 'badge-checkin'}">${c.channel_category}</span></td>
      <td><strong>${(c.commission_rate * 100).toFixed(0)}%</strong></td>
    </tr>
  `).join('');
}

function resetChannelsFilter() {
  if (document.getElementById('search-channels')) document.getElementById('search-channels').value = '';
  if (document.getElementById('filter-chan-cat')) document.getElementById('filter-chan-cat').value = 'all';
  filterChannelsList();
}

// ─── 4. Realtime Duration & Financial Calculation ───
function handleCheckinTimeChange() {
  const inVal = document.getElementById('f-checkin-time').value;
  const nights = parseInt(document.getElementById('f-nights').value) || 0;
  if (inVal && nights > 0) {
    syncCheckoutFromNights();
  } else if (inVal) {
    const inDate = new Date(inVal);
    const outDate = new Date(inDate.getTime() + 2 * 3600 * 1000);
    const pad = n => n < 10 ? '0' + n : n;
    document.getElementById('f-checkout-time').value = `${outDate.getFullYear()}-${pad(outDate.getMonth()+1)}-${pad(outDate.getDate())}T${pad(outDate.getHours())}:${pad(outDate.getMinutes())}`;
  }
  handleRoomSelect();
}

function handleCheckoutTimeChange() {
  const inVal = document.getElementById('f-checkin-time').value;
  const outVal = document.getElementById('f-checkout-time').value;
  if (!inVal || !outVal) return;

  const inDate = new Date(inVal);
  const outDate = new Date(outVal);
  let diffMs = outDate.getTime() - inDate.getTime();

  if (diffMs <= 0) {
    const newOut = new Date(inDate.getTime() + 2 * 3600 * 1000);
    const pad = n => n < 10 ? '0' + n : n;
    document.getElementById('f-checkout-time').value = `${newOut.getFullYear()}-${pad(newOut.getMonth()+1)}-${pad(newOut.getDate())}T${pad(newOut.getHours())}:${pad(newOut.getMinutes())}`;
    diffMs = 2 * 3600 * 1000;
  }

  const diffHours = Math.max(0.5, Math.round((diffMs / (1000 * 3600)) * 10) / 10);
  const isSameDay = (inDate.getFullYear() === outDate.getFullYear() && inDate.getMonth() === outDate.getMonth() && inDate.getDate() === outDate.getDate());

  if (isSameDay && diffHours < 24) {
    document.getElementById('f-nights').value = 0;
  } else {
    let diffDays = Math.max(1, Math.round(diffMs / (1000 * 3600 * 24)));
    document.getElementById('f-nights').value = diffDays;
  }
  handleRoomSelect();
}

function handleNightsInputChange() {
  const nights = parseInt(document.getElementById('f-nights').value);
  if (nights > 0) {
    syncCheckoutFromNights();
  } else {
    const inVal = document.getElementById('f-checkin-time').value;
    if (inVal) {
      const inDate = new Date(inVal);
      const outDate = new Date(inDate.getTime() + 2 * 3600 * 1000);
      const pad = n => n < 10 ? '0' + n : n;
      document.getElementById('f-checkout-time').value = `${outDate.getFullYear()}-${pad(outDate.getMonth()+1)}-${pad(outDate.getDate())}T${pad(outDate.getHours())}:${pad(outDate.getMinutes())}`;
    }
  }
  handleRoomSelect();
}

function syncCheckoutFromNights() {
  const inVal = document.getElementById('f-checkin-time').value;
  const nights = parseInt(document.getElementById('f-nights').value) || 1;
  if (inVal) {
    const inDate = new Date(inVal);
    const outDate = new Date(inDate.getTime());
    outDate.setDate(outDate.getDate() + nights);
    outDate.setHours(12, 0, 0, 0);
    const pad = n => n < 10 ? '0' + n : n;
    document.getElementById('f-checkout-time').value = `${outDate.getFullYear()}-${pad(outDate.getMonth()+1)}-${pad(outDate.getDate())}T${pad(outDate.getHours())}:${pad(outDate.getMinutes())}`;
  }
}

function handleRoomSelect() {
  const roomId = document.getElementById('f-room').value;
  const room = roomsData.find(x => x.room_id == roomId);
  const nights = parseInt(document.getElementById('f-nights').value);
  const inVal = document.getElementById('f-checkin-time').value;
  const outVal = document.getElementById('f-checkout-time').value;

  let diffHours = 2;
  if (inVal && outVal) {
    diffHours = Math.max(0.5, (new Date(outVal) - new Date(inVal)) / 3600000);
  }

  if (room) {
    if (nights > 0) {
      document.getElementById('f-roomrev').value = room.base_price * nights;
    } else {
      const first2h = Math.round((room.base_price * 0.35) / 10000) * 10000;
      let hourlyPrice = first2h;
      if (diffHours > 2) {
        hourlyPrice += Math.round((diffHours - 2) * 40000);
      }
      document.getElementById('f-roomrev').value = hourlyPrice;
    }
  }
  calculateRealtimeFinances();
}

function calculateRealtimeFinances() {
  const nights = parseInt(document.getElementById('f-nights').value);
  const inVal = document.getElementById('f-checkin-time').value;
  const outVal = document.getElementById('f-checkout-time').value;
  let diffHours = 2;
  if (inVal && outVal) {
    diffHours = Math.max(0.5, (new Date(outVal) - new Date(inVal)) / 3600000);
  }

  const roomRev = parseFloat(document.getElementById('f-roomrev').value) || 0;
  const servRev = parseFloat(document.getElementById('f-servrev').value) || 0;
  const debtOld = parseFloat(document.getElementById('f-debtold').value) || 0;

  const cash = parseFloat(document.getElementById('f-cash').value) || 0;
  const card = parseFloat(document.getElementById('f-card').value) || 0;
  const trans = parseFloat(document.getElementById('f-trans').value) || 0;
  const debtTree = parseFloat(document.getElementById('f-debttree').value) || 0;

  const total = roomRev + servRev + debtOld;
  const paid = cash + card + trans + debtTree;
  const due = total - paid;

  const adr = (nights > 0) ? (roomRev / nights) : roomRev;

  document.getElementById('c-total').innerText = formatVND(total);
  document.getElementById('c-paid').innerText = formatVND(paid);

  const dueEl = document.getElementById('c-due');
  dueEl.innerText = formatVND(due);
  dueEl.style.color = due <= 0 ? 'var(--success)' : 'var(--danger)';

  document.getElementById('c-adr').innerText = (nights > 0) ? formatVND(adr) : `${formatVND(adr)} / đợt giờ`;
}

// ─── 5. Submit Booking (Gọi Stored Procedure DAB: CheckIn) ──
async function submitNewBooking(e) {
  e.preventDefault();
  const nights = parseInt(document.getElementById('f-nights').value) || 1;
  const checkinVal = document.getElementById('f-checkin-time')?.value;
  const checkoutVal = document.getElementById('f-checkout-time')?.value;
  
  const checkinTime = checkinVal ? new Date(checkinVal).toISOString() : new Date().toISOString();
  const checkoutTime = checkoutVal ? new Date(checkoutVal).toISOString() : new Date(Date.now() + 86400000).toISOString();

  const payload = {
    CustomerName: document.getElementById('f-name').value.trim(),
    PhoneNumber: document.getElementById('f-phone').value.trim(),
    IdNumber: document.getElementById('f-idnum').value.trim() || null,
    Nationality: document.getElementById('f-nation').value.trim() || 'Việt Nam',
    RoomID: parseInt(document.getElementById('f-room').value),
    ChannelID: parseInt(document.getElementById('f-chan').value),
    CheckInTime: checkinTime,
    CheckOutTime: checkoutTime,
    Nights: Math.max(1, nights),
    RoomRevenue: parseFloat(document.getElementById('f-roomrev').value) || 0,
    CashAmount: parseFloat(document.getElementById('f-cash').value) || 0,
    CardAmount: parseFloat(document.getElementById('f-card').value) || 0,
    TransferAmount: parseFloat(document.getElementById('f-trans').value) || 0,
    DebtAmount: parseFloat(document.getElementById('f-debttree').value) || 0
  };

  try {
    const res = await fetch(`${API_BASE}/CheckIn`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error?.message || err.detail || 'Lỗi đặt phòng');
    }

    const data = await res.json();
    const resObj = (data.value && data.value[0]) ? data.value[0] : data;
    showToast(`Check-in thành công! Mã: ${resObj.BookingID || ''}`);
    resetCheckinForm();
    await initAllData();
    switchNavTab('tab-bookings');
  } catch (err) {
    showToast(`Lỗi: ${err.message}`);
  }
}

function resetCheckinForm() {
  const form = document.getElementById('form-checkin');
  if (form) form.reset();
  
  const nationEl = document.getElementById('f-nation');
  if (nationEl) nationEl.value = 'Việt Nam';
  
  const nightsEl = document.getElementById('f-nights');
  if (nightsEl) nightsEl.value = 1;

  const now = new Date();
  const pad = n => n < 10 ? '0' + n : n;
  const localISO = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}`;
  const inTimeEl = document.getElementById('f-checkin-time');
  if (inTimeEl) inTimeEl.value = localISO;

  syncCheckoutFromNights();
  handleRoomSelect();
  calculateRealtimeFinances();
}

// ─── 6. Bookings List (Gọi DAB: FactBooking) ───────────
async function fetchBookings() {
  try {
    const raw = await apiGet('FactBooking?$orderby=CreatedAt desc');
    
    // Enrich với tên khách và số phòng từ cache
    const custMap = new Map(customersData.map(c => [c.customer_id, c]));
    const roomMap = new Map(roomsData.map(r => [r.room_id, r]));

    bookingsData = raw.map(b => {
      const norm = normalizeBooking(b);
      const cust = custMap.get(norm.customer_id);
      const room = roomMap.get(norm.room_id);
      if (cust) {
        norm.customer_name = cust.full_name;
        norm.customer_phone = cust.phone_number;
      }
      if (room) {
        norm.room_number = room.room_number;
      }
      return norm;
    });

    filterBookingsList();
  } catch (err) {
    console.error("Bookings error:", err);
  }
}

function filterBookingsList() {
  const q = (document.getElementById('search-q')?.value || '').trim().toLowerCase();
  const st = (document.getElementById('filter-st')?.value) || 'all';

  const isGenericPrefix = (q === 'b' || q === 'bk' || q === 'bk-' || q === 'bk_');

  const filtered = bookingsData.filter(b => {
    let matchQ = true;
    if (q) {
      const matchCust = (b.customer_name || '').toLowerCase().includes(q);
      const matchPhone = (b.customer_phone || '').toLowerCase().includes(q);
      const matchRoom = (b.room_number || '').toLowerCase().includes(q);
      const matchNotes = (b.notes || '').toLowerCase().includes(q);
      const matchBid = !isGenericPrefix && (b.booking_id || '').toLowerCase().includes(q);

      matchQ = matchCust || matchPhone || matchRoom || matchNotes || matchBid;
    }

    const matchSt = (st === 'all') || (b.booking_status === st);
    return matchQ && matchSt;
  });

  renderBookingsList(filtered);
}

function resetBookingsFilter() {
  if (document.getElementById('search-q')) document.getElementById('search-q').value = '';
  if (document.getElementById('filter-st')) document.getElementById('filter-st').value = 'all';
  filterBookingsList();
}

function renderBookingsList(list) {
  const tbody = document.getElementById('tbody-bookings');
  if (!tbody) return;
  if (list.length === 0) {
    tbody.innerHTML = '<tr><td colspan="14" style="text-align: center; color: var(--text-muted); padding: 1.5rem;">Không tìm thấy đơn lưu trú nào phù hợp</td></tr>';
    return;
  }

  tbody.innerHTML = list.map(b => {
    const paid = (b.cash_amount || 0) + (b.card_amount || 0) + (b.transfer_amount || 0) + (b.debt_amount || 0);
    let badge = 'badge-checkin';
    if (b.booking_status === 'CHECKOUT') badge = 'badge-checkout';
    if (b.booking_status === 'CANCELLED') badge = 'badge-occupied';

    const durationText = (b.nights && b.nights > 0) ? `${b.nights} đêm` : `Theo giờ`;
    const checkInDisplay = formatDateTime(b.check_in_time);

    let checkOutDisplay = '-';
    if (b.check_out_time) {
      checkOutDisplay = `<strong style="color:#1E293B;">${formatDateTime(b.check_out_time)}</strong>`;
    } else if (b.booking_status === 'CHECKIN') {
      if (b.nights && b.nights > 0) {
        checkOutDisplay = `<span style="color:#64748B;" title="Dự kiến trả phòng">${formatEstimatedCheckout(b.check_in_time, b.nights)} <span style="font-size:0.75rem; color:#0284C7; font-weight:600;">(Dự kiến)</span></span>`;
      } else {
        checkOutDisplay = `<span style="color:#64748B; font-style:italic;">Đang lưu trú</span>`;
      }
    } else if (b.booking_status === 'CANCELLED') {
      checkOutDisplay = `<span style="color:var(--danger); font-size:0.85rem;">Đã hủy</span>`;
    }

    let actions = '-';
    if (b.booking_status === 'CHECKIN') {
      actions = `
        <button class="btn btn-success btn-sm" onclick="openCheckoutModal('${b.booking_id}','${b.customer_name}','${b.room_number}','${b.check_in_time}')">Trả phòng</button>
        <button class="btn btn-danger btn-sm" onclick="cancelBookingAction('${b.booking_id}', ${b.room_id})">Hủy</button>
      `;
    }

    return `
      <tr>
        <td><strong style="color:var(--v-blue); font-size:0.85rem;">${b.booking_id}</strong></td>
        <td><span class="status-badge badge-checkin">P.${b.room_number}</span></td>
        <td><strong>${b.customer_name || '-'}</strong></td>
        <td>${b.customer_phone || '-'}</td>
        <td style="white-space:nowrap;"><strong style="color:#1E293B;">${checkInDisplay}</strong></td>
        <td style="white-space:nowrap;">${checkOutDisplay}</td>
        <td><span class="status-badge" style="background:#F1F5F9; color:#334155;">${durationText}</span></td>
        <td>${formatVND(b.room_revenue)}</td>
        <td>${formatVND(b.service_revenue)}</td>
        <td><strong style="color:var(--v-blue);">${formatVND(b.gross_revenue)}</strong></td>
        <td>${formatVND(paid)}</td>
        <td style="color:${b.balance_due > 0 ? 'var(--danger)' : 'var(--success)'}; font-weight:700;">${formatVND(b.balance_due)}</td>
        <td><span class="status-badge ${badge}">${b.booking_status}</span></td>
        <td style="display:flex; gap:4px;">${actions}</td>
      </tr>
    `;
  }).join('');
}

// ─── 7. Checkout Modal & Action (Gọi DAB: CheckOut) ──
function openCheckoutModal(bid, cust, room, checkInTimeStr) {
  activeCheckoutId = bid;
  document.getElementById('m-bid').innerText = bid;
  document.getElementById('m-cust').innerText = cust;
  document.getElementById('m-room').innerText = room;

  if (checkInTimeStr && checkInTimeStr !== 'null' && checkInTimeStr !== 'undefined') {
    const inTime = new Date(checkInTimeStr);
    const now = new Date();
    const diffMs = Math.max(0, now - inTime);
    const diffHours = (diffMs / (1000 * 60 * 60)).toFixed(1);
    const inTimeStrFormatted = inTime.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }) + ' (' + inTime.toLocaleDateString('vi-VN') + ')';
    document.getElementById('m-duration').innerHTML = `Giờ nhận phòng: <strong>${inTimeStrFormatted}</strong> | Đã ở: <strong>${diffHours} giờ</strong>`;
  } else {
    document.getElementById('m-duration').innerText = 'Thời gian lưu trú: Hoàn tất đợt nghỉ';
  }

  document.getElementById('checkout-modal').classList.add('show');
}

function closeCheckoutModal() {
  document.getElementById('checkout-modal').classList.remove('show');
}

async function confirmCheckoutAction() {
  try {
    const payload = {
      BookingID: activeCheckoutId,
      ServiceRevenue: 0,
      CashAmount: 0,
      CardAmount: 0,
      TransferAmount: 0,
      DebtAmount: 0
    };

    const res = await fetch(`${API_BASE}/CheckOut`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (res.ok) {
      closeCheckoutModal();
      showToast('Check-out & trả phòng thành công!');
      await initAllData();
    } else {
      showToast('Lỗi khi check-out');
    }
  } catch (err) {
    showToast('Lỗi khi check-out: ' + err.message);
  }
}

async function cancelBookingAction(bid, roomId) {
  if (confirm(`Hủy đơn đặt phòng ${bid}? Phòng sẽ được chuyển về trạng thái sẵn sàng.`)) {
    try {
      // Cập nhật trạng thái FactBooking
      await fetch(`${API_BASE}/FactBooking/BookingID/${bid}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ BookingStatus: 'CANCELLED' })
      });

      // Cập nhật trạng thái DimRoom
      if (roomId) {
        await fetch(`${API_BASE}/UpdateCleanStatus`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ RoomID: roomId, CleanStatus: 'clean' })
        });
      }

      showToast('Đã hủy đơn thành công!');
      await initAllData();
    } catch (err) {
      showToast('Lỗi khi hủy đơn: ' + err.message);
    }
  }
}

// ─── 8. Customers (Gọi DAB: DimCustomer) ───────────────
async function fetchCustomers() {
  try {
    const raw = await apiGet('DimCustomer');
    customersData = raw.map(normalizeCustomer);
    filterCustomersList();
  } catch (err) {
    console.error("Customers error:", err);
  }
}

function filterCustomersList() {
  const q = (document.getElementById('search-customers')?.value || '').trim().toLowerCase();

  const filtered = customersData.filter(c => {
    return !q || (
      (c.full_name || '') + ' ' +
      (c.phone_number || '') + ' ' +
      (c.id_number || '') + ' ' +
      (c.nationality || '') + ' ' +
      (c.customer_id || '')
    ).toLowerCase().includes(q);
  });

  renderCustomersList(filtered);
}

function renderCustomersList(list) {
  const tbody = document.getElementById('tbody-customers');
  if (!tbody) return;
  if (list.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" style="text-align: center; color: var(--text-muted); padding: 1.5rem;">Không tìm thấy khách hàng nào phù hợp</td></tr>';
    return;
  }

  tbody.innerHTML = list.map(c => `
    <tr>
      <td>${c.customer_id}</td>
      <td><strong style="color:var(--v-blue);">${c.full_name}</strong></td>
      <td>${c.phone_number}</td>
      <td>${c.id_number || '-'}</td>
      <td>${c.nationality || 'Việt Nam'}</td>
    </tr>
  `).join('');
}

function resetCustomersFilter() {
  if (document.getElementById('search-customers')) document.getElementById('search-customers').value = '';
  filterCustomersList();
}
