// ============================================
// 2026 Bullet Journal — App
// ============================================

const STORAGE_KEY = "bj2026_entries";
const TOKEN_KEY = "bj2026_gh_token";
const REPO_OWNER = "huhyoujung";
const REPO_NAME = "2026-journal";
const DATA_PATH = "data/entries.json";

let routines = { daily: [], weekly: [] };
let currentSha = null; // GitHub 파일의 SHA (업데이트 시 필요)
let isDirty = false; // 로컬 변경 있는지

// ── 동기화 상태 표시 ──
function setSyncStatus(state) {
  const dot = document.getElementById("syncStatus");
  const btn = document.getElementById("saveBtn");
  dot.className = "sync-status " + state;
  switch (state) {
    case "saved":
      dot.title = "저장됨";
      btn.textContent = "저장됨";
      btn.disabled = true;
      break;
    case "dirty":
      dot.title = "저장 필요";
      btn.textContent = "저장";
      btn.disabled = false;
      break;
    case "saving":
      dot.title = "저장 중...";
      btn.textContent = "저장 중...";
      btn.disabled = true;
      break;
    case "error":
      dot.title = "저장 실패";
      btn.textContent = "재시도";
      btn.disabled = false;
      break;
    case "offline":
      dot.title = "토큰 없음";
      btn.textContent = "연결";
      btn.disabled = false;
      break;
  }
}

// ── GitHub API ──
function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}

async function ghFetch(method, body = null) {
  const token = getToken();
  if (!token) return null;

  const opts = {
    method,
    headers: {
      Authorization: `token ${token}`,
      Accept: "application/vnd.github.v3+json",
    },
  };
  if (body) {
    opts.headers["Content-Type"] = "application/json";
    opts.body = JSON.stringify(body);
  }

  const res = await fetch(
    `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents/${DATA_PATH}`,
    opts
  );
  return res;
}

// GitHub에서 엔트리 불러오기
async function loadFromGitHub() {
  try {
    const res = await ghFetch("GET");
    if (!res || res.status === 404) return null;
    if (!res.ok) return null;

    const data = await res.json();
    currentSha = data.sha;
    const content = atob(data.content.replace(/\n/g, ""));
    return JSON.parse(content);
  } catch (e) {
    console.warn("GitHub 로드 실패:", e);
    return null;
  }
}

// GitHub에 엔트리 저장
async function saveToGitHub(entries) {
  const token = getToken();
  if (!token) return false;

  try {
    setSyncStatus("saving");

    // 최신 SHA 가져오기 (충돌 방지)
    const getRes = await ghFetch("GET");
    if (getRes && getRes.ok) {
      const existing = await getRes.json();
      currentSha = existing.sha;
    }

    const content = btoa(unescape(encodeURIComponent(JSON.stringify(entries, null, 2))));
    const body = {
      message: `journal: ${new Date().toLocaleDateString("ko-KR")} 업데이트`,
      content,
    };
    if (currentSha) body.sha = currentSha;

    const res = await ghFetch("PUT", body);
    if (res && res.ok) {
      const result = await res.json();
      currentSha = result.content.sha;
      isDirty = false;
      setSyncStatus("saved");
      return true;
    } else {
      const errText = res ? await res.text() : "no response";
      console.error("GitHub 저장 실패:", errText);
      setSyncStatus("error");
      return false;
    }
  } catch (e) {
    console.error("GitHub 저장 에러:", e);
    setSyncStatus("error");
    return false;
  }
}

// ── 초기화 ──
document.addEventListener("DOMContentLoaded", async () => {
  await loadRoutines();
  await loadEntries();

  // 저장 버튼
  document.getElementById("saveBtn").addEventListener("click", async () => {
    const token = getToken();
    if (!token) {
      showTokenModal();
      return;
    }
    const entries = collectEntries();
    await saveToGitHub(entries);
  });

  // 토큰 모달
  document.getElementById("tokenSave").addEventListener("click", async () => {
    const input = document.getElementById("tokenInput");
    const token = input.value.trim();
    if (!token) return;

    localStorage.setItem(TOKEN_KEY, token);
    hideTokenModal();

    // 바로 저장 시도
    const entries = collectEntries();
    await saveToGitHub(entries);
  });

  document.getElementById("tokenSkip").addEventListener("click", hideTokenModal);

  // 새 페이지 버튼
  document.getElementById("newPageBtn").addEventListener("click", () => {
    const entry = createEntry();
    const rightEntries = document.getElementById("entries-right");
    rightEntries.appendChild(entry);
    entry.querySelector(".date-input").focus();
    markDirty();
    rebalancePages();
  });

  // 토큰 없으면 모달 표시
  if (!getToken()) {
    setSyncStatus("offline");
  }
});

// ── 토큰 모달 ──
function showTokenModal() {
  document.getElementById("tokenModal").classList.add("visible");
}

function hideTokenModal() {
  document.getElementById("tokenModal").classList.remove("visible");
}

// ── 변경 표시 ──
function markDirty() {
  isDirty = true;
  saveLocal();
  if (getToken()) {
    setSyncStatus("dirty");
  }
}

// ── 루틴 데이터 로드 ──
async function loadRoutines() {
  try {
    const res = await fetch("data/routines.json");
    const data = await res.json();
    routines.daily = data.daily || [];
    routines.weekly = data.weekly || [];
  } catch (e) {
    console.warn("루틴 데이터 로드 실패, 기본값 사용:", e);
  }
}

// ── 엔트리 생성 ──
function createEntry(data = null) {
  const tpl = document.getElementById("entryTemplate");
  const entry = tpl.content.cloneNode(true).querySelector(".entry");
  const id = data?.id || crypto.randomUUID();
  entry.dataset.id = id;

  // 날짜
  const dateInput = entry.querySelector(".date-input");
  if (data?.date) {
    dateInput.value = data.date;
  } else {
    const now = new Date();
    const days = ["일", "월", "화", "수", "목", "금", "토"];
    dateInput.placeholder = `${now.getMonth() + 1}.${now.getDate()} ${days[now.getDay()]}`;
  }
  dateInput.addEventListener("input", markDirty);

  // 삭제 버튼
  entry.querySelector(".delete-entry-btn").addEventListener("click", () => {
    if (confirm("이 페이지를 삭제할까요?")) {
      entry.remove();
      markDirty();
      rebalancePages();
    }
  });

  // 체크리스트 — Daily
  const dailyList = entry.querySelector(".daily-checklist");
  routines.daily.forEach((r) => {
    const checked = data?.checks?.[r.id] || false;
    dailyList.appendChild(createCheckItem(r, checked));
  });

  // 체크리스트 — Weekly
  const weeklyList = entry.querySelector(".weekly-checklist");
  routines.weekly.forEach((r) => {
    const checked = data?.checks?.[r.id] || false;
    weeklyList.appendChild(createCheckItem(r, checked));
  });

  // 달성률 바
  const completionBar = document.createElement("div");
  completionBar.className = "completion-bar";
  completionBar.innerHTML = `
    <div class="completion-track"><div class="completion-fill"></div></div>
    <span class="completion-text">0%</span>
  `;
  entry.querySelector(".routine-section").appendChild(completionBar);
  updateCompletion(entry);

  // Brain dump — 오늘 할 일
  const bdList = entry.querySelector(".braindump-list");
  const bdAdd = entry.querySelector(".braindump-add");

  const QUADRANTS = {
    q1: { label: "🔥", title: "긴급·중요" },
    q2: { label: "🎯", title: "중요·비긴급" },
    q3: { label: "📋", title: "긴급·비중요" },
    q4: { label: "💤", title: "비긴급·비중요" },
  };

  function addBraindumpItem(text = "", done = false, quadrant = "") {
    const item = document.createElement("div");
    item.className = "bd-item" + (done ? " done" : "");
    if (quadrant) item.dataset.q = quadrant;
    item.innerHTML = `
      <span class="bd-bullet">•</span>
      <button class="bd-quadrant" title="사분면 지정">${quadrant ? QUADRANTS[quadrant]?.label : "·"}</button>
      <input type="text" class="bd-text" placeholder="할 일..." value="${escapeHtml(text)}" />
      <button class="bd-delete" title="삭제">×</button>
    `;

    // 완료 토글
    const bullet = item.querySelector(".bd-bullet");
    bullet.addEventListener("click", () => {
      item.classList.toggle("done");
      markDirty();
      syncMatrix(entry);
    });

    // 사분면 순환: 없음 → q1 → q2 → q3 → q4 → 없음
    const qBtn = item.querySelector(".bd-quadrant");
    const qOrder = ["", "q1", "q2", "q3", "q4"];
    qBtn.addEventListener("click", () => {
      const current = item.dataset.q || "";
      const idx = qOrder.indexOf(current);
      const next = qOrder[(idx + 1) % qOrder.length];
      if (next) {
        item.dataset.q = next;
        qBtn.textContent = QUADRANTS[next].label;
        qBtn.title = QUADRANTS[next].title;
      } else {
        delete item.dataset.q;
        qBtn.textContent = "·";
        qBtn.title = "사분면 지정";
      }
      markDirty();
      syncMatrix(entry);
    });

    const input = item.querySelector(".bd-text");
    input.addEventListener("input", () => {
      markDirty();
      syncMatrix(entry);
    });
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        addBraindumpItem();
        const next = item.nextElementSibling;
        if (next) next.querySelector(".bd-text")?.focus();
      }
      if (e.key === "Backspace" && input.value === "") {
        e.preventDefault();
        const prev = item.previousElementSibling;
        item.remove();
        markDirty();
        syncMatrix(entry);
        if (prev) {
          const prevInput = prev.querySelector(".bd-text");
          prevInput?.focus();
        }
      }
    });

    item.querySelector(".bd-delete").addEventListener("click", () => {
      item.remove();
      markDirty();
      syncMatrix(entry);
    });

    bdList.appendChild(item);
    return input;
  }

  // 매트릭스 뷰 토글
  const viewToggle = entry.querySelector(".braindump-view-toggle");
  const matrixView = entry.querySelector(".matrix-view");
  viewToggle.addEventListener("click", () => {
    const showing = matrixView.style.display !== "none";
    matrixView.style.display = showing ? "none" : "block";
    viewToggle.textContent = showing ? "⊞" : "☰";
    if (!showing) syncMatrix(entry);
  });

  // 저장된 brain dump 불러오기
  if (data?.tasks && data.tasks.length) {
    data.tasks.forEach((t) => addBraindumpItem(t.text, t.done, t.quadrant || ""));
  }

  bdAdd.addEventListener("click", () => {
    const input = addBraindumpItem();
    input.focus();
  });

  // 자유 텍스트
  const textarea = entry.querySelector(".free-text");
  if (data?.text) textarea.value = data.text;
  textarea.addEventListener("input", () => {
    autoResize(textarea);
    markDirty();
  });
  requestAnimationFrame(() => autoResize(textarea));

  return entry;
}

// ── 매트릭스 뷰 동기화 ──
function syncMatrix(entryEl) {
  const matrixView = entryEl.querySelector(".matrix-view");
  if (!matrixView || matrixView.style.display === "none") return;

  // 매트릭스 셀 초기화
  matrixView.querySelectorAll(".matrix-items").forEach((c) => (c.innerHTML = ""));

  // brain dump 항목들을 매트릭스에 배치
  entryEl.querySelectorAll(".bd-item").forEach((bd) => {
    const q = bd.dataset.q;
    const text = bd.querySelector(".bd-text").value;
    if (!q || !text) return;

    const cell = matrixView.querySelector(`.matrix-cell[data-q="${q}"] .matrix-items`);
    if (!cell) return;

    const tag = document.createElement("span");
    tag.className = "matrix-tag" + (bd.classList.contains("done") ? " done" : "");
    tag.textContent = text;
    cell.appendChild(tag);
  });
}

// ── HTML 이스케이프 ──
function escapeHtml(str) {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// ── 체크 아이템 생성 ──
function createCheckItem(routine, checked) {
  const tpl = document.getElementById("checkItemTemplate");
  const item = tpl.content.cloneNode(true).querySelector(".check-item");

  item.querySelector(".check-label").textContent = routine.label;
  item.dataset.id = routine.id;

  if (checked) {
    item.classList.add("done");
    item.querySelector(".check-mark").textContent = "✓";
  }

  item.addEventListener("click", () => {
    const isDone = item.classList.toggle("done");
    item.querySelector(".check-mark").textContent = isDone ? "✓" : "·";
    const entry = item.closest(".entry");
    updateCompletion(entry);
    markDirty();
  });

  return item;
}

// ── 달성률 업데이트 ──
function updateCompletion(entryEl) {
  const items = entryEl.querySelectorAll(".check-item");
  const done = entryEl.querySelectorAll(".check-item.done");
  const total = items.length;
  const pct = total > 0 ? Math.round((done.length / total) * 100) : 0;

  const fill = entryEl.querySelector(".completion-fill");
  const text = entryEl.querySelector(".completion-text");
  if (fill) fill.style.width = pct + "%";
  if (text) text.textContent = pct + "%";
}

// ── 자동 높이 조절 ──
function autoResize(textarea) {
  textarea.style.height = "auto";
  textarea.style.height = textarea.scrollHeight + "px";
}

// ── 엔트리 데이터 수집 ──
function collectEntries() {
  const entries = [];
  document.querySelectorAll(".entry").forEach((el) => {
    const checks = {};
    el.querySelectorAll(".check-item").forEach((item) => {
      checks[item.dataset.id] = item.classList.contains("done");
    });
    // Brain dump tasks
    const tasks = [];
    el.querySelectorAll(".bd-item").forEach((bd) => {
      const text = bd.querySelector(".bd-text").value;
      if (text) {
        const task = { text, done: bd.classList.contains("done") };
        if (bd.dataset.q) task.quadrant = bd.dataset.q;
        tasks.push(task);
      }
    });

    entries.push({
      id: el.dataset.id,
      date: el.querySelector(".date-input").value,
      checks,
      tasks,
      text: el.querySelector(".free-text").value,
    });
  });
  return entries;
}

// ── 로컬 저장 (즉시, 캐시 역할) ──
function saveLocal() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(collectEntries()));
}

// ── 불러오기 (GitHub 우선 → localStorage 폴백) ──
async function loadEntries() {
  let data = null;

  // GitHub에서 먼저 시도
  if (getToken()) {
    data = await loadFromGitHub();
    if (data) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
      setSyncStatus("saved");
    }
  }

  // GitHub 실패 시 로컬에서
  if (!data) {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      data = JSON.parse(saved);
    }
  }

  const allEntries = [];
  if (data && data.length) {
    data.forEach((d) => allEntries.push(createEntry(d)));
  }

  if (!allEntries.length) {
    allEntries.push(createEntry());
  }

  distributeEntries(allEntries);
}

// ── 엔트리를 좌/우 페이지에 분배 ──
function distributeEntries(entryEls) {
  const left = document.getElementById("entries-left");
  const right = document.getElementById("entries-right");
  left.innerHTML = "";
  right.innerHTML = "";

  // 마지막 엔트리는 오른쪽, 나머지는 왼쪽부터 채움
  // (다이어리를 펼쳤을 때: 왼쪽 = 지난 기록, 오른쪽 = 최근/오늘)
  if (entryEls.length === 1) {
    right.appendChild(entryEls[0]);
  } else {
    const mid = Math.ceil(entryEls.length / 2);
    entryEls.forEach((el, i) => {
      if (i < mid) {
        left.appendChild(el);
      } else {
        right.appendChild(el);
      }
    });
  }
}

// ── 페이지 재분배 (엔트리 추가/삭제 후) ──
function rebalancePages() {
  const all = Array.from(document.querySelectorAll(".entry"));
  distributeEntries(all);
}

// ── 월별 루틴 테이블 렌더링 ──
function renderRoutineTable() {
  const container = document.getElementById("routineTableContainer");
  if (!container) return;
  container.innerHTML = "";

  const entries = Array.from(document.querySelectorAll(".entry"));
  if (!entries.length) return;

  // 현재 달의 일 개수 계산
  const now = new Date();
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  
  // 엔트리 맵: 날짜 -> entry 객체
  const entryMap = {};
  entries.forEach((el) => {
    const dateStr = el.querySelector(".date-input").value;
    if (dateStr) {
      const day = parseInt(dateStr.split(".")[1]);
      entryMap[day] = el;
    }
  });

  // 테이블 생성
  const table = document.createElement("table");
  table.className = "routine-table";

  // 헤더: 루틴 이름 + 날짜
  const thead = document.createElement("thead");
  const headerRow = document.createElement("tr");
  const routineHeaderCell = document.createElement("th");
  routineHeaderCell.textContent = "루틴";
  headerRow.appendChild(routineHeaderCell);

  for (let day = 1; day <= daysInMonth; day++) {
    const th = document.createElement("th");
    th.textContent = day;
    headerRow.appendChild(th);
  }
  thead.appendChild(headerRow);
  table.appendChild(thead);

  // 바디: 각 루틴별 행
  const tbody = document.createElement("tbody");
  const allRoutines = [...(routines.daily || []), ...(routines.weekly || [])];

  allRoutines.forEach((routine) => {
    const row = document.createElement("tr");
    
    const labelCell = document.createElement("td");
    labelCell.textContent = routine.label;
    row.appendChild(labelCell);

    for (let day = 1; day <= daysInMonth; day++) {
      const cell = document.createElement("td");
      const entry = entryMap[day];
      const isDone = entry ? 
        entry.querySelector(`.check-item[data-id="${routine.id}"]`)?.classList.contains("done") :
        false;

      cell.className = "routine-check-cell" + (isDone ? " done" : "");
      cell.textContent = isDone ? "✓" : "·";
      cell.style.cursor = entry ? "pointer" : "default";
      cell.style.opacity = entry ? "1" : "0.3";

      if (entry) {
        cell.addEventListener("click", () => {
          const checkItem = entry.querySelector(`.check-item[data-id="${routine.id}"]`);
          if (checkItem) {
            checkItem.click();
            renderRoutineTable(); // 테이블 새로고침
          }
        });
      }
      row.appendChild(cell);
    }
    tbody.appendChild(row);
  });

  table.appendChild(tbody);
  container.appendChild(table);
}

// ── 모달 열기/닫기 ──
function openRoutineModal() {
  const modal = document.getElementById("routineModal");
  if (modal) {
    renderRoutineTable();
    modal.classList.add("visible");
  }
}

function closeRoutineModal() {
  const modal = document.getElementById("routineModal");
  if (modal) {
    modal.classList.remove("visible");
  }
}

// ── 스와이프 페이지 네비게이션 ──
let currentPage = 0;
let touchStartX = 0;
let touchStartY = 0;

document.addEventListener("touchstart", (e) => {
  touchStartX = e.touches[0].clientX;
  touchStartY = e.touches[0].clientY;
}, false);

document.addEventListener("touchend", (e) => {
  const touchEndX = e.changedTouches[0].clientX;
  const touchEndY = e.changedTouches[0].clientY;
  
  const deltaX = touchEndX - touchStartX;
  const deltaY = Math.abs(touchEndY - touchStartY);
  
  // 수평 스와이프만 감지 (수직 스크롤은 무시)
  if (Math.abs(deltaX) > 50 && deltaY < 50) {
    const notebook = document.querySelector(".notebook");
    
    if (deltaX < 0) {
      // 좌측 스와이프: 다음 페이지
      currentPage++;
      notebook.style.transform = `translateX(calc(-100vw * ${currentPage}))`;
      
      // 마지막 페이지면 신규 엔트리 추가
      const entries = Array.from(document.querySelectorAll(".entry"));
      if (currentPage > Math.ceil(entries.length / 2)) {
        setTimeout(() => {
          const newEntry = createEntry();
          const right = document.getElementById("entries-right");
          right.innerHTML = "";
          right.appendChild(newEntry);
          markDirty();
        }, 250);
      }
    } else if (deltaX > 0 && currentPage > 0) {
      // 우측 스와이프: 이전 페이지
      currentPage--;
      notebook.style.transform = `translateX(calc(-100vw * ${currentPage}))`;
    }
  }
}, false);

// ── 초기 로드 및 이벤트 ──
loadRoutines().then(() => {
  loadEntries();
});

// 루틴 토글 버튼
document.getElementById("routineToggleBtn").addEventListener("click", openRoutineModal);
document.getElementById("routineModalClose").addEventListener("click", closeRoutineModal);

// 모달 배경 클릭으로 닫기
document.getElementById("routineModal").addEventListener("click", (e) => {
  if (e.target === document.getElementById("routineModal")) {
    closeRoutineModal();
  }
});

// 저장 버튼
document.getElementById("saveBtn").addEventListener("click", async () => {
  if (!getToken()) {
    showTokenModal();
    return;
  }
  setSyncStatus("saving");
  try {
    await saveToGitHub(collectEntries());
    setSyncStatus("saved");
  } catch (e) {
    console.error("저장 실패:", e);
    setSyncStatus("error");
  }
});

// 토큰 모달
document.getElementById("tokenSkip").addEventListener("click", hideTokenModal);
document.getElementById("tokenSave").addEventListener("click", () => {
  const token = document.getElementById("tokenInput").value;
  if (token) {
    localStorage.setItem(TOKEN_KEY, token);
    hideTokenModal();
    setSyncStatus("dirty");
  }
});

