/**
 * A26 Hotel PMS — Application Logic
 * Native integration with Azure Data API Builder (DAB) & Azure SQL
 */

let roomsData = [], channelsData = [], bookingsData = [], customersData = [], activeCheckoutId = null;
const PAGE_SIZE = 20;
let currentBookingsPage = 1, currentCustomersPage = 1;

// Cấu hình kết nối API DAB trên Azure Container Apps:
// ponytail: default to live ACA DAB endpoint with optional localStorage override
const LIVE_ACA_API = 'https://dab-hotel-pms.kindforest-00f4cba9.southeastasia.azurecontainerapps.io/api';
const isLocalhost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
const customApiBase = window.DAB_API_BASE || localStorage.getItem('DAB_API_BASE');
const API_BASE = customApiBase 
  ? customApiBase.replace(/\/$/, '') 
  : (isLocalhost && window.location.port === '5000' ? '/api' : LIVE_ACA_API);

// ─── Helpers định dạng dữ liệu ───────────────────────────
const pad = n => String(n).padStart(2, '0');
const toLocalISOString = (d = new Date()) => 
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;

const formatVND = val => (Math.round(val || 0)).toLocaleString('vi-VN') + ' đ';

const formatDateTime = dtStr => {
  if (!dtStr) return '-';
  const d = new Date(dtStr);
  if (isNaN(d.getTime())) return dtStr;
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${String(d.getFullYear()).slice(-2)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

const formatEstimatedCheckout = (inTimeStr, nights) => {
  if (!inTimeStr || !nights) return '-';
  const d = new Date(inTimeStr);
  if (isNaN(d.getTime())) return '-';
  d.setDate(d.getDate() + nights);
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${String(d.getFullYear()).slice(-2)} 12:00`;
};

function showToast(text) {
  const toast = document.getElementById('toast-msg');
  if (!toast) return;
  toast.innerText = text;
  toast.style.display = 'block';
  setTimeout(() => { toast.style.display = 'none'; }, 3500);
}

// Helper giải nén data trả về từ DAB, tự động duyệt nextLink để lấy toàn bộ các trang (pagination)
// ponytail: automatically iterate nextLink to load 100% of items without DAB 100-row page truncation
async function apiGet(entityPath) {
  let allItems = [];
  let currentUrl = entityPath.startsWith('http') ? entityPath : `${API_BASE}/${entityPath}`;

  while (currentUrl) {
    const res = await fetch(currentUrl);
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
    const json = await res.json();

    if (Array.isArray(json)) {
      allItems = allItems.concat(json);
      break;
    } else if (json && Array.isArray(json.value)) {
      allItems = allItems.concat(json.value);
      if (json.nextLink) {
        currentUrl = json.nextLink.startsWith('http') 
          ? json.nextLink 
          : `${API_BASE}${json.nextLink.startsWith('/') ? '' : '/'}${json.nextLink}`;
      } else {
        currentUrl = null;
      }
    } else {
      return json;
    }
  }
  return allItems;
}

// ─── Chuẩn hóa dữ liệu tương thích CSDL Azure SQL ───────
function normalizeRoom(r) {
  return {
    room_id: Number(r.RoomID ?? r.room_id),
    room_number: r.RoomNumber ?? r.room_number,
    room_type: r.RoomType ?? r.room_type,
    floor: Number(r.Floor ?? r.floor ?? 1),
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
    channel_id: Number(c.ChannelID ?? c.channel_id),
    channel_name: c.ChannelName ?? c.channel_name,
    channel_category: c.ChannelCategory ?? c.channel_category ?? 'Direct',
    commission_rate: comm > 1 ? (comm / 100) : comm
  };
}

function normalizeCustomer(c) {
  return {
    customer_id: Number(c.CustomerID ?? c.customer_id),
    full_name: c.FullName ?? c.full_name ?? '',
    phone_number: c.PhoneNumber ?? c.phone_number ?? '',
    id_number: c.IdNumber ?? c.id_number,
    nationality: c.Nationality ?? c.nationality ?? 'Việt Nam'
  };
}

function normalizeBooking(b) {
  return {
    booking_id: b.BookingID ?? b.booking_id,
    customer_id: Number(b.CustomerID ?? b.customer_id),
    customer_name: b.CustomerName ?? b.customer_name ?? b.FullName ?? b.full_name ?? '',
    customer_phone: b.CustomerPhone ?? b.customer_phone ?? b.PhoneNumber ?? b.phone_number ?? '',
    room_id: Number(b.RoomID ?? b.room_id),
    room_number: b.RoomNumber ?? b.room_number ?? '',
    channel_id: Number(b.ChannelID ?? b.channel_id),
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
  resetCheckinForm();
  initAllData();
});

async function reloadAllData() {
  const statusText = document.getElementById('header-status-text');
  const statusDot = document.getElementById('header-status-dot');
  if (statusText) statusText.innerText = 'ĐANG KẾT NỐI AZURE DAB...';
  if (statusDot) statusDot.style.background = 'var(--v-blue)';
  showToast('Đang gửi request kết nối & tải dữ liệu từ Azure DAB...');
  await initAllData(true);
}

async function initAllData(isManual = false) {
  const statusText = document.getElementById('header-status-text');
  const statusDot = document.getElementById('header-status-dot');
  try {
    await Promise.all([
      fetchRooms(),
      fetchChannels(),
      fetchCustomers()
    ]);
    await fetchBookings();
    updateDashboardStats();

    if (roomsData.length > 0 || channelsData.length > 0) {
      if (statusText) statusText.innerText = 'HỆ THỐNG TRỰC TUYẾN (AZURE DAB ACTIVE)';
      if (statusDot) statusDot.style.background = '#10b981';
      if (isManual) showToast('Đã tải dữ liệu thành công từ Azure DAB');
    } else {
      if (statusText) statusText.innerText = 'CHƯA NHẬN ĐƯỢC DỮ LIỆU TỪ API';
    }
  } catch (err) {
    console.error("Lỗi đồng bộ dữ liệu ban đầu:", err);
    if (statusText) statusText.innerText = 'LỖI KẾT NỐI AZURE DAB';
    if (statusDot) statusDot.style.background = '#ef4444';
    showToast('Không thể tải dữ liệu từ Azure DAB. Nếu Azure đang ngủ, vui lòng bấm "Tải lại dữ liệu" sau 15-30 giây.');
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

    let primaryAction = '';
    if (r.status === 'cleaning') {
      primaryAction = `<button class="btn btn-success btn-sm" onclick="updateRoomCleanAction(${r.room_id}, 'clean')" title="Đã dọn dẹp xong">Dọn xong</button>`;
    } else if (r.status === 'available') {
      primaryAction = `<button class="btn btn-vinamilk btn-sm" onclick="quickSelectRoom(${r.room_id})" title="Nhận phòng ngay">Check-in</button>`;
    }

    const editBtn = `<button class="btn btn-edit btn-sm" onclick="openRoomModal(${r.room_id})" title="Sửa thông tin phòng">Sửa</button>`;

    return `
      <tr>
        <td><strong style="font-family:'Be Vietnam Pro',sans-serif; color:var(--v-blue);">${r.room_number}</strong></td>
        <td>${r.room_type}</td>
        <td>Tầng ${r.floor}</td>
        <td><strong>${formatVND(r.base_price)}</strong></td>
        <td><span class="status-badge ${badge}">${text}</span></td>
        <td>
          <div style="display: flex; gap: 6px; align-items: center;">
            ${primaryAction}
            ${editBtn}
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

function resetRoomsFilter() {
  if (document.getElementById('search-rooms')) document.getElementById('search-rooms').value = '';
  if (document.getElementById('filter-room-st')) document.getElementById('filter-room-st').value = 'all';
  filterRoomsList();
}

// ─── Quản lý Thêm / Sửa / Xóa Phòng (CRUD DimRoom qua DAB) ───
function openRoomModal(roomId = null) {
  const modal = document.getElementById('room-modal');
  const title = document.getElementById('room-modal-title');
  const form = document.getElementById('form-room');
  const delBtn = document.getElementById('btn-delete-room');
  if (form) form.reset();

  const idInput = document.getElementById('modal-room-id');
  const numInput = document.getElementById('modal-room-number');
  const floorInput = document.getElementById('modal-room-floor');
  const typeInput = document.getElementById('modal-room-type');
  const priceInput = document.getElementById('modal-room-price');
  const stInput = document.getElementById('modal-room-status');

  if (roomId) {
    const room = roomsData.find(r => r.room_id === roomId);
    if (!room) return;
    if (title) title.innerText = `Chỉnh Sửa Phòng ${room.room_number}`;
    if (idInput) idInput.value = room.room_id;
    if (numInput) numInput.value = room.room_number;
    if (floorInput) floorInput.value = room.floor;
    if (typeInput) typeInput.value = room.room_type;
    if (priceInput) priceInput.value = room.base_price;
    if (stInput) stInput.value = room.status;
    if (delBtn) delBtn.style.display = 'block';
  } else {
    if (title) title.innerText = 'Thêm Phòng Mới';
    if (idInput) idInput.value = '';
    if (floorInput) floorInput.value = 1;
    if (priceInput) priceInput.value = 350000;
    if (stInput) stInput.value = 'available';
    if (delBtn) delBtn.style.display = 'none';
  }

  if (modal) modal.classList.add('show');
}

function handleDeleteFromModal() {
  const id = parseInt(document.getElementById('modal-room-id').value);
  const num = document.getElementById('modal-room-number').value;
  const st = document.getElementById('modal-room-status').value;
  if (!id) return;
  closeRoomModal();
  deleteRoomAction(id, num, st);
}

function closeRoomModal() {
  const modal = document.getElementById('room-modal');
  if (modal) modal.classList.remove('show');
}

async function saveRoomAction(e) {
  e.preventDefault();
  const id = document.getElementById('modal-room-id').value;
  const roomNumber = document.getElementById('modal-room-number').value.trim();
  const floor = parseInt(document.getElementById('modal-room-floor').value) || 1;
  const roomType = document.getElementById('modal-room-type').value;
  const basePrice = parseFloat(document.getElementById('modal-room-price').value) || 0;
  const status = document.getElementById('modal-room-status').value;

  if (!roomNumber) {
    showToast('Vui lòng nhập số phòng');
    return;
  }

  try {
    if (id) {
      // Cập nhật phòng (PATCH qua DAB)
      const res = await fetch(`${API_BASE}/DimRoom/RoomID/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          RoomNumber: roomNumber,
          RoomType: roomType,
          Floor: floor,
          BasePrice: basePrice,
          Status: status
        })
      });
      if (!res.ok) throw new Error('Không thể cập nhật thông tin phòng');
      showToast(`Đã cập nhật phòng ${roomNumber} thành công`);
    } else {
      // Thêm phòng mới (POST qua DAB)
      const res = await fetch(`${API_BASE}/DimRoom`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          RoomNumber: roomNumber,
          RoomType: roomType,
          Floor: floor,
          BasePrice: basePrice,
          Status: status,
          CleanStatus: 'clean'
        })
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error?.message || err.detail || 'Không thể tạo phòng mới');
      }
      showToast(`Đã thêm phòng ${roomNumber} mới thành công`);
    }

    closeRoomModal();
    await initAllData();
  } catch (err) {
    showToast(`Lỗi: ${err.message}`);
  }
}

async function deleteRoomAction(roomId, roomNumber, status) {
  if (status === 'occupied') {
    showToast(`Phòng ${roomNumber} đang có khách ở, vui lòng thực hiện Check-out trước khi xóa!`);
    return;
  }

  if (confirm(`Bạn có chắc chắn muốn xóa vĩnh viễn Phòng ${roomNumber} khỏi hệ thống?`)) {
    try {
      const res = await fetch(`${API_BASE}/DimRoom/RoomID/${roomId}`, {
        method: 'DELETE'
      });
      if (res.ok || res.status === 204) {
        showToast(`Đã xóa phòng ${roomNumber} thành công`);
        await initAllData();
      } else {
        showToast(`Không thể xóa phòng ${roomNumber} (có thể phòng đã có dữ liệu đặt phòng liên kết)`);
      }
    } catch (err) {
      showToast(`Lỗi khi xóa phòng: ${err.message}`);
    }
  }
}

async function updateRoomCleanAction(roomId, cleanStatus = 'clean') {
  try {
    const res = await fetch(`${API_BASE}/DimRoom/RoomID/${roomId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        Status: 'available',
        CleanStatus: cleanStatus,
        LastCleanedAt: new Date().toISOString()
      })
    });

    if (res.ok) {
      showToast('Đã dọn dẹp xong - Phòng đã sẵn sàng đón khách!');
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
    document.getElementById('f-checkout-time').value = toLocalISOString(new Date(inDate.getTime() + 2 * 3600 * 1000));
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
    document.getElementById('f-checkout-time').value = toLocalISOString(new Date(inDate.getTime() + 2 * 3600 * 1000));
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
      document.getElementById('f-checkout-time').value = toLocalISOString(new Date(inDate.getTime() + 2 * 3600 * 1000));
    }
  }
  handleRoomSelect();
}

function syncCheckoutFromNights() {
  const inVal = document.getElementById('f-checkin-time').value;
  const nights = parseInt(document.getElementById('f-nights').value) || 1;
  if (inVal) {
    const outDate = new Date(inVal);
    outDate.setDate(outDate.getDate() + nights);
    outDate.setHours(12, 0, 0, 0);
    document.getElementById('f-checkout-time').value = toLocalISOString(outDate);
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

  const inTimeEl = document.getElementById('f-checkin-time');
  if (inTimeEl) inTimeEl.value = toLocalISOString();

  syncCheckoutFromNights();
  handleRoomSelect();
  calculateRealtimeFinances();
}

// ─── 6. Bookings List (Gọi DAB: FactBooking) ───────────
async function fetchBookings() {
  try {
    const raw = await apiGet('FactBooking?$orderby=CreatedAt desc');
    
    // Enrich với tên khách và số phòng từ cache
    const custMap = new Map(customersData.map(c => [Number(c.customer_id), c]));
    const roomMap = new Map(roomsData.map(r => [Number(r.room_id), r]));

    bookingsData = raw.map(b => {
      const norm = normalizeBooking(b);
      const cust = custMap.get(Number(norm.customer_id));
      const room = roomMap.get(Number(norm.room_id));
      if (cust) {
        norm.customer_name = cust.full_name || norm.customer_name;
        norm.customer_phone = cust.phone_number || norm.customer_phone;
      }
      if (room) {
        norm.room_number = room.room_number || norm.room_number;
      }
      return norm;
    });

    filterBookingsList();
    if (customersData && customersData.length > 0) {
      filterCustomersList();
    }
  } catch (err) {
    console.error("Bookings error:", err);
  }
}

function filterBookingsList(resetPage = false) {
  if (resetPage) currentBookingsPage = 1;
  const q = (document.getElementById('search-q')?.value || '').trim().toLowerCase();
  const st = (document.getElementById('filter-st')?.value) || 'all';
  const dueFilter = (document.getElementById('filter-due')?.value) || 'all';

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

    let matchDue = true;
    const due = Number(b.balance_due || 0);
    if (dueFilter === 'unpaid') {
      matchDue = due > 0;
    } else if (dueFilter === 'paid') {
      matchDue = due === 0;
    } else if (dueFilter === 'overpaid') {
      matchDue = due < 0;
    }

    return matchQ && matchSt && matchDue;
  });

  const totalItems = filtered.length;
  const totalPages = Math.ceil(totalItems / PAGE_SIZE) || 1;
  if (currentBookingsPage > totalPages) currentBookingsPage = totalPages;
  if (currentBookingsPage < 1) currentBookingsPage = 1;

  const startIdx = (currentBookingsPage - 1) * PAGE_SIZE;
  const pageItems = filtered.slice(startIdx, startIdx + PAGE_SIZE);

  renderBookingsList(pageItems);
  renderPaginationControls('pagination-controls-bookings', 'pagination-info-bookings', currentBookingsPage, totalPages, totalItems, 'đơn', 'goToBookingsPage');
}

function goToBookingsPage(page) {
  currentBookingsPage = page;
  filterBookingsList(false);
  const tableEl = document.getElementById('tab-bookings');
  if (tableEl) tableEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function resetBookingsFilter() {
  if (document.getElementById('search-q')) document.getElementById('search-q').value = '';
  if (document.getElementById('filter-st')) document.getElementById('filter-st').value = 'all';
  if (document.getElementById('filter-due')) document.getElementById('filter-due').value = 'all';
  currentBookingsPage = 1;
  filterBookingsList(true);
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
        <button class="btn btn-edit btn-sm" onclick="openEditBookingModal('${b.booking_id}')">Sửa sổ cái</button>
        <button class="btn btn-danger btn-sm" onclick="cancelBookingAction('${b.booking_id}', ${b.room_id})">Hủy</button>
      `;
    } else if (b.booking_status === 'CHECKOUT') {
      actions = `
        <button class="btn ${b.balance_due > 0 ? 'btn-vinamilk' : 'btn-edit'} btn-sm" onclick="openEditBookingModal('${b.booking_id}')">
          ${b.balance_due > 0 ? 'Thu nợ / Sửa' : 'Sửa sổ cái'}
        </button>
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
        await fetch(`${API_BASE}/DimRoom/RoomID/${roomId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ Status: 'available', CleanStatus: 'clean' })
        }).catch(() => {});
      }

      showToast('Đã hủy đơn thành công!');
      await initAllData();
    } catch (err) {
      showToast('Lỗi khi hủy đơn: ' + err.message);
    }
  }
}

// ─── 8. Edit Booking / Settle Debt Modal ─────────────
function openEditBookingModal(bid) {
  const b = bookingsData.find(x => x.booking_id === bid);
  if (!b) {
    showToast('Không tìm thấy thông tin đơn đặt phòng');
    return;
  }

  const channel = channelsData.find(c => c.channel_id === b.channel_id);
  const commRate = channel ? channel.commission_rate : 0;

  document.getElementById('eb-booking-id').value = b.booking_id;
  document.getElementById('eb-bid').innerText = b.booking_id;
  document.getElementById('eb-cust').innerText = b.customer_name || 'Khách vãng lai';
  document.getElementById('eb-room').innerText = b.room_number ? `P.${b.room_number}` : '--';
  
  const badgeEl = document.getElementById('eb-badge');
  if (badgeEl) {
    badgeEl.innerText = b.booking_status;
    badgeEl.className = 'status-badge ' + (b.booking_status === 'CHECKOUT' ? 'badge-checkout' : 'badge-checkin');
  }

  document.getElementById('eb-room-revenue').value = b.room_revenue || 0;
  document.getElementById('eb-roomrev-text').innerText = formatVND(b.room_revenue);
  document.getElementById('eb-comm-rate').value = commRate;

  document.getElementById('eb-servrev').value = b.service_revenue || 0;
  document.getElementById('eb-cash').value = b.cash_amount || 0;
  document.getElementById('eb-card').value = b.card_amount || 0;
  document.getElementById('eb-trans').value = b.transfer_amount || 0;
  document.getElementById('eb-debt').value = b.debt_amount || 0;

  calculateEditBookingFinances();
  document.getElementById('edit-booking-modal').classList.add('show');
}

function closeEditBookingModal() {
  document.getElementById('edit-booking-modal').classList.remove('show');
}

function calculateEditBookingFinances() {
  const roomRev = parseFloat(document.getElementById('eb-room-revenue').value) || 0;
  const servRev = parseFloat(document.getElementById('eb-servrev').value) || 0;
  const cash = parseFloat(document.getElementById('eb-cash').value) || 0;
  const card = parseFloat(document.getElementById('eb-card').value) || 0;
  const trans = parseFloat(document.getElementById('eb-trans').value) || 0;
  const debt = parseFloat(document.getElementById('eb-debt').value) || 0;

  const total = roomRev + servRev;
  const paid = cash + card + trans + debt;
  const due = total - paid;

  const totalEl = document.getElementById('eb-total-text');
  if (totalEl) totalEl.innerText = formatVND(total);

  const paidEl = document.getElementById('eb-paid-text');
  if (paidEl) paidEl.innerText = formatVND(paid);

  const dueEl = document.getElementById('eb-due-text');
  if (dueEl) {
    dueEl.innerText = formatVND(due);
    dueEl.style.color = due <= 0 ? 'var(--success)' : 'var(--danger)';
  }
}

function settleAllVia(type) {
  const roomRev = parseFloat(document.getElementById('eb-room-revenue').value) || 0;
  const servRev = parseFloat(document.getElementById('eb-servrev').value) || 0;
  const total = roomRev + servRev;

  let cash = parseFloat(document.getElementById('eb-cash').value) || 0;
  let card = parseFloat(document.getElementById('eb-card').value) || 0;
  let trans = parseFloat(document.getElementById('eb-trans').value) || 0;

  // Xóa số nợ treo cũ khi đã thu đủ
  document.getElementById('eb-debt').value = 0;

  if (type === 'trans') {
    const remaining = Math.max(0, total - cash - card);
    document.getElementById('eb-trans').value = remaining;
  } else if (type === 'cash') {
    const remaining = Math.max(0, total - card - trans);
    document.getElementById('eb-cash').value = remaining;
  }

  calculateEditBookingFinances();
}

async function saveEditBookingAction(e) {
  e.preventDefault();
  const bid = document.getElementById('eb-booking-id').value;
  const roomRev = parseFloat(document.getElementById('eb-room-revenue').value) || 0;
  const servRev = parseFloat(document.getElementById('eb-servrev').value) || 0;
  const cash = parseFloat(document.getElementById('eb-cash').value) || 0;
  const card = parseFloat(document.getElementById('eb-card').value) || 0;
  const trans = parseFloat(document.getElementById('eb-trans').value) || 0;
  const debt = parseFloat(document.getElementById('eb-debt').value) || 0;
  const commRate = parseFloat(document.getElementById('eb-comm-rate').value) || 0;

  const grossRev = roomRev + servRev;
  const commAmount = roomRev * commRate;
  const netRev = grossRev - commAmount;
  const balanceDue = grossRev - (cash + card + trans + debt);

  const btn = document.getElementById('btn-save-eb');
  if (btn) btn.disabled = true;

  try {
    const payload = {
      ServiceRevenue: servRev,
      GrossRevenue: grossRev,
      CommissionAmount: commAmount,
      NetRevenue: netRev,
      CashAmount: cash,
      CardAmount: card,
      TransferAmount: trans,
      DebtAmount: debt,
      BalanceDue: balanceDue,
      UpdatedAt: new Date().toISOString()
    };

    const res = await fetch(`${API_BASE}/FactBooking/BookingID/${encodeURIComponent(bid)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.error?.message || errData.detail || `HTTP ${res.status}`);
    }

    closeEditBookingModal();
    showToast(`Đã cập nhật sổ cái đơn ${bid} thành công!`);
    await initAllData();
  } catch (err) {
    showToast(`Lỗi cập nhật sổ cái: ${err.message}`);
  } finally {
    if (btn) btn.disabled = false;
  }
}

// ─── 9. Customers (Gọi DAB: DimCustomer) ───────────────
async function fetchCustomers() {
  try {
    const raw = await apiGet('DimCustomer');
    customersData = raw.map(normalizeCustomer);
    filterCustomersList();
  } catch (err) {
    console.error("Customers error:", err);
  }
}

// ponytail: in-memory lookup of latest check-in for customer from bookingsData
function getCustomerLatestCheckIn(customer) {
  if (!bookingsData || bookingsData.length === 0) return null;
  const cId = Number(customer.customer_id);
  const cPhone = (customer.phone_number || '').trim().replace(/[\s\-\.\(\)]/g, '');

  let latestBooking = null;
  let maxTime = 0;

  for (const b of bookingsData) {
    let isMatch = false;
    if (cId && Number(b.customer_id) === cId) {
      isMatch = true;
    } else if (cPhone && b.customer_phone) {
      const bPhone = String(b.customer_phone).trim().replace(/[\s\-\.\(\)]/g, '');
      if (bPhone && (bPhone === cPhone || (bPhone.length >= 8 && cPhone.endsWith(bPhone)) || (cPhone.length >= 8 && bPhone.endsWith(cPhone)))) {
        isMatch = true;
      }
    }

    if (isMatch) {
      const t = new Date(b.check_in_time || b.created_at || 0).getTime();
      if (!isNaN(t) && t > maxTime) {
        maxTime = t;
        latestBooking = b;
      }
    }
  }

  return latestBooking;
}

function filterCustomersList(resetPage = false) {
  if (resetPage) currentCustomersPage = 1;
  const q = (document.getElementById('search-customers')?.value || '').trim().toLowerCase();

  const filtered = customersData.filter(c => {
    const latest = getCustomerLatestCheckIn(c);
    const checkinStr = latest ? formatDateTime(latest.check_in_time || latest.created_at) : '';
    return !q || (
      (c.full_name || '') + ' ' +
      (c.phone_number || '') + ' ' +
      (c.id_number || '') + ' ' +
      (c.nationality || '') + ' ' +
      (c.customer_id || '') + ' ' +
      checkinStr
    ).toLowerCase().includes(q);
  });

  const totalItems = filtered.length;
  const totalPages = Math.ceil(totalItems / PAGE_SIZE) || 1;
  if (currentCustomersPage > totalPages) currentCustomersPage = totalPages;
  if (currentCustomersPage < 1) currentCustomersPage = 1;

  const startIdx = (currentCustomersPage - 1) * PAGE_SIZE;
  const pageItems = filtered.slice(startIdx, startIdx + PAGE_SIZE);

  renderCustomersList(pageItems);
  renderPaginationControls('pagination-customers-controls', 'pagination-info-customers', currentCustomersPage, totalPages, totalItems, 'khách hàng', 'goToCustomersPage');
}

function goToCustomersPage(page) {
  currentCustomersPage = page;
  filterCustomersList(false);
  const tableEl = document.getElementById('tab-customers');
  if (tableEl) tableEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function renderCustomersList(list) {
  const tbody = document.getElementById('tbody-customers');
  if (!tbody) return;
  if (list.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" style="text-align: center; color: var(--text-muted); padding: 1.5rem;">Không tìm thấy khách hàng nào phù hợp</td></tr>';
    return;
  }

  tbody.innerHTML = list.map(c => {
    const latest = getCustomerLatestCheckIn(c);
    let checkinDisplay = '<span style="color:var(--text-muted); font-size:12px;">-</span>';
    if (latest && (latest.check_in_time || latest.created_at)) {
      const timeStr = formatDateTime(latest.check_in_time || latest.created_at);
      const roomBadge = latest.room_number 
        ? `<span style="font-size:11px; color:var(--text-muted); margin-left:6px; background:#f1f5f9; padding:2px 6px; border-radius:4px;">P.${latest.room_number}</span>` 
        : '';
      checkinDisplay = `<div style="display:inline-flex; align-items:center;"><strong style="color:var(--text-main); font-weight:600;">${timeStr}</strong>${roomBadge}</div>`;
    }

    return `
      <tr>
        <td>${c.customer_id}</td>
        <td><strong style="color:var(--v-blue);">${c.full_name}</strong></td>
        <td>${c.phone_number || '-'}</td>
        <td>${c.id_number || '-'}</td>
        <td>${c.nationality || 'Việt Nam'}</td>
        <td>${checkinDisplay}</td>
      </tr>
    `;
  }).join('');
}

function resetCustomersFilter() {
  if (document.getElementById('search-customers')) document.getElementById('search-customers').value = '';
  currentCustomersPage = 1;
  filterCustomersList(true);
}

// ─── Reusable Pagination Renderer ──────────────────────
function renderPaginationControls(containerId, infoId, currentPage, totalPages, totalCount, itemName, onPageChangeName) {
  const infoEl = document.getElementById(infoId);
  const containerEl = document.getElementById(containerId);
  if (!containerEl) return;

  if (totalCount === 0) {
    if (infoEl) infoEl.innerText = `0 ${itemName}`;
    containerEl.innerHTML = '';
    return;
  }

  const start = (currentPage - 1) * PAGE_SIZE + 1;
  const end = Math.min(currentPage * PAGE_SIZE, totalCount);
  if (infoEl) {
    infoEl.innerHTML = `Hiển thị <strong>${start}–${end}</strong> / <strong>${totalCount.toLocaleString('vi-VN')}</strong> ${itemName} (Trang ${currentPage}/${totalPages})`;
  }

  if (totalPages <= 1) {
    containerEl.innerHTML = '';
    return;
  }

  let html = '';

  // Nút First & Prev
  html += `<button class="page-btn" ${currentPage === 1 ? 'disabled' : ''} onclick="${onPageChangeName}(1)" title="Trang đầu">&laquo;</button>`;
  html += `<button class="page-btn" ${currentPage === 1 ? 'disabled' : ''} onclick="${onPageChangeName}(${currentPage - 1})" title="Trang trước">&lsaquo;</button>`;

  // Sinh các số trang thông minh: Luôn hiển thị trang 1, trang cuối, và các trang lân cận currentPage (-2 đến +2)
  let pages = [];
  for (let i = 1; i <= totalPages; i++) {
    if (i === 1 || i === totalPages || (i >= currentPage - 2 && i <= currentPage + 2)) {
      pages.push(i);
    }
  }

  let prev = 0;
  for (const p of pages) {
    if (prev && p - prev > 1) {
      html += `<span class="page-dots">...</span>`;
    }
    html += `<button class="page-btn ${p === currentPage ? 'active' : ''}" onclick="${onPageChangeName}(${p})">${p}</button>`;
    prev = p;
  }

  // Nút Next & Last
  html += `<button class="page-btn" ${currentPage === totalPages ? 'disabled' : ''} onclick="${onPageChangeName}(${currentPage + 1})" title="Trang sau">&rsaquo;</button>`;
  html += `<button class="page-btn" ${currentPage === totalPages ? 'disabled' : ''} onclick="${onPageChangeName}(${totalPages})" title="Trang cuối">&raquo;</button>`;

  containerEl.innerHTML = html;
}

// ─── 9. Tự động nhận diện khách hàng quen qua Số Điện Thoại ───
// ponytail: instant in-memory lookup from customersData/bookingsData with fallback
function handlePhoneLookup() {
  const phoneInput = document.getElementById('f-phone');
  if (!phoneInput) return;
  const rawPhone = phoneInput.value.trim().replace(/[\s\-\.\(\)]/g, '');
  if (rawPhone.length < 8) return; // Chỉ tìm khi nhập từ 8 ký tự trở lên

  // Tìm trong danh mục DimCustomer đã nạp
  let matched = customersData.find(c => {
    if (!c.phone_number) return false;
    const cleanP = String(c.phone_number).trim().replace(/[\s\-\.\(\)]/g, '');
    return cleanP === rawPhone || (cleanP.length >= 8 && rawPhone.endsWith(cleanP)) || (rawPhone.length >= 8 && cleanP.endsWith(rawPhone));
  });

  // Nếu chưa có trong DimCustomer, tìm lịch sử trong FactBooking
  if (!matched && bookingsData && bookingsData.length > 0) {
    const bMatch = bookingsData.find(b => {
      if (!b.customer_phone) return false;
      const cleanP = String(b.customer_phone).trim().replace(/[\s\-\.\(\)]/g, '');
      return cleanP === rawPhone || (cleanP.length >= 8 && rawPhone.endsWith(cleanP)) || (rawPhone.length >= 8 && cleanP.endsWith(rawPhone));
    });
    if (bMatch) {
      matched = {
        full_name: bMatch.customer_name,
        phone_number: bMatch.customer_phone,
        id_number: '',
        nationality: 'Việt Nam'
      };
    }
  }

  if (matched) {
    const nameEl = document.getElementById('f-name');
    const idEl = document.getElementById('f-idnum');
    const nationEl = document.getElementById('f-nation');

    if (nameEl && matched.full_name) nameEl.value = matched.full_name;
    if (idEl && matched.id_number) idEl.value = matched.id_number;
    if (nationEl && matched.nationality) nationEl.value = matched.nationality;

    showToast(`Đã nhận diện khách quen: ${matched.full_name}`);
  }
}

// Helper tải lại iframe Dashboard Power BI
function reloadDashboardIframe() {
  const iframe = document.getElementById('pbi-iframe');
  if (iframe) {
    const src = iframe.src;
    iframe.src = '';
    iframe.src = src;
    showToast('Đang tải lại Dashboard Power BI...');
  }
}
