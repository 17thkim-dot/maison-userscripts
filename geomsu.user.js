// ==UserScript==
// @name         스타일씨 체험단 검수 자동화
// @namespace    maison-once-a-year
// @version      41.0
// @description  [v41.0] IP차단 방지 안전판 — 접근차단/에러 감지 시 자동 즉시중단, 요청 간격 상향(수집 2.5s·캠페인이동 4s), 페이지네이션 상한(50p). v40.2 재검수 + v40.1 취소요청 일괄승인 + v40 영구원장/백업 유지.
// @match        *://*.stylec.co.kr/*
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_registerMenuCommand
// @grant        GM_xmlhttpRequest
// @grant        unsafeWindow
// @connect      stylec.co.kr
// @connect      coupang.com
// @connect      coupangcdn.com
// @connect      self
// @connect      *
// @updateURL    https://raw.githubusercontent.com/17thkim-dot/maison-userscripts/main/geomsu.user.js
// @downloadURL  https://raw.githubusercontent.com/17thkim-dot/maison-userscripts/main/geomsu.user.js
// @run-at       document-start
// ==/UserScript==

(function () {
  'use strict';

  /* ═════════ [v21] 사이트 네이티브 알림창 완전 무력화 (4시간 멈춤 원인 제거) ═════════ */
  // 원인: Tampermonkey 격리창(window)만 덮으면 사이트가 실제 호출하는 페이지 원본창(unsafeWindow)의
  //       alert/confirm/prompt가 그대로 살아 네이티브 창을 띄우고 JS 전체를 얼렸다.
  // 대책: 원본창까지 함께 덮고, @run-at document-start로 사이트보다 먼저 잡고, 1초마다 재적용.
  const _페이지창 = (typeof unsafeWindow !== 'undefined' && unsafeWindow) ? unsafeWindow : window;
  // [v25] 우리 대화창·키입력창은 무력화 '전에' 원본을 bind로 잡아둔다.
  //   (v21~v24는 .call(_페이지창) 방식이 Illegal invocation으로 깨져 확인창·키입력이 안 떠 버튼이 무반응이었음)
  const _알림 = window.alert.bind(window);
  const _확인 = window.confirm.bind(window);
  const _프롬 = window.prompt.bind(window);
  let _사이트마지막알림 = null;   // [v37] 사이트가 띄우려던 알림(반려 서버에러 등)을 캡처 → 반려 성공/실패 정직 판정
  let 차단됨 = false;   // [v41] IP차단/접근불가 감지 시 모든 자동화 즉시 정지
  const 차단문구 = /(접근\s*불가|비정상적?인?\s*접근|접근이?\s*(제한|차단)됨?|일시적으로\s*(제한|차단)|too\s*many\s*requests|forbidden|\b403\b|\b429\b|\b503\b)/i;
  const 알림무력화 = () => {
    const 무시알림 = function (m) { try { _사이트마지막알림 = { t: Date.now(), m: String(m) }; console.log('⚠ 사이트 알림 무시: ' + m); if (차단문구.test(String(m)) && typeof 차단걸림 === 'function') 차단걸림('사이트 알림: ' + String(m).slice(0, 120)); } catch (e) {} };
    const 자동확인 = function (m) { try { console.log('⚠ 사이트 확인 자동통과: ' + m); } catch (e) {} return true; };
    const 자동프롬 = function (m, d) { try { console.log('⚠ 사이트 프롬프트 자동: ' + m); } catch (e) {} return d != null ? d : ''; };
    for (const w of [_페이지창, window]) {
      try { w.alert = 무시알림; } catch (e) {}
      try { w.confirm = 자동확인; } catch (e) {}
      try { w.prompt = 자동프롬; } catch (e) {}
      try { w.onbeforeunload = null; } catch (e) {}
    }
  };
  알림무력화();
  setInterval(알림무력화, 1000);

  /* ═════════ 공용 유틸 ═════════ */
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const 제외어 = ['검수 전', '검수완료', '검수 완료', '리뷰 보기', '인플루언서'];
  const V = (t, root = document) => [...root.querySelectorAll('*')]
    .filter(e => e.children.length === 0 && e.textContent.trim() === t && e.offsetParent !== null);
  const 대기찾기 = async (fn, n = 14, ms = 600) => { for (let i = 0; i < n; i++) { const r = fn(); if (r) return r; await sleep(ms); } return null; };
  const 이름뽑기 = txt => (txt || '').split('\n').map(s => s.trim()).filter(s => /^[가-힣]{2,4}$/.test(s) && !제외어.includes(s))[0] || '';
  const 숫자만 = v => String(v || '').replace(/\D/g, '');
  const 편집거리 = (a, b) => {
    const m = a.length, n = b.length; if (!m) return n; if (!n) return m;
    const dp = Array.from({ length: m + 1 }, (_, i) => { const r = new Array(n + 1).fill(0); r[0] = i; return r; });
    for (let j = 0; j <= n; j++) dp[0][j] = j;
    for (let i = 1; i <= m; i++) for (let j = 1; j <= n; j++)
      dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] : 1 + Math.min(dp[i - 1][j - 1], dp[i - 1][j], dp[i][j - 1]);
    return dp[m][n];
  };

  /* ═════════ 저장소 ═════════ */
  const G = {
    get(k, d) { try { return (typeof GM_getValue === 'function') ? GM_getValue(k, d) : (localStorage.getItem(k) ?? d); } catch (e) { return localStorage.getItem(k) ?? d; } },
    set(k, v) { try { if (typeof GM_setValue === 'function') GM_setValue(k, v); else localStorage.setItem(k, v); } catch (e) { localStorage.setItem(k, v); } }
  };
  const 키이름 = 'anthropic_api_key', 누적키 = 'juksu_accum_v8', 오케키 = 'juksu_orch_v8';
  const 키확보 = () => { let k = G.get(키이름, ''); if (!k) { k = _프롬('Anthropic API 키 (sk-ant-...) — 이 브라우저에만 저장됩니다'); if (k) { G.set(키이름, k.trim()); k = k.trim(); } } return k; };
  const 누적읽기 = () => { try { const s = G.get(누적키, '{}'); return s ? JSON.parse(s) : {}; } catch (e) { return {}; } };
  const 누적쓰기 = o => G.set(누적키, JSON.stringify(o));
  const 오케읽기 = () => { try { const s = G.get(오케키, ''); return s ? JSON.parse(s) : { mode: 'idle', queue: [], idx: 0 }; } catch (e) { return { mode: 'idle', queue: [], idx: 0 }; } };
  const 오케쓰기 = o => G.set(오케키, JSON.stringify(o));
  const 문제키 = 'juksu_problem_v13';
  const 문제읽기 = () => { try { return JSON.parse(G.get(문제키, '[]')); } catch (e) { return []; } };
  const 문제추가 = (code, reason) => { const a = 문제읽기(); a.push({ code: code || '?', reason }); G.set(문제키, JSON.stringify(a)); };
  const 문제비우기 = () => G.set(문제키, '[]');
  // [v17] 페이지네이션 수집 상태 (주소 page= 를 바꿔가며 전 페이지 수집)
  const 수집키 = 'juksu_collect_v17';
  const 수집읽기 = () => { try { return JSON.parse(G.get(수집키, '')) || { active: false, codes: [] }; } catch (e) { return { active: false, codes: [] }; } };
  const 수집쓰기 = o => G.set(수집키, JSON.stringify(o));

  /* ═════════ [v40] 주문번호 영구 원장 (독립 저장 — 누적 초기화와 완전 분리) ═════════ */
  // 구조: { "주문번호(숫자만)": { 캠, 이름, 번호, 주문일, 검수일, 판정 } }
  // 최초 등록된 주문번호가 '원본'. 이후 다른 캠페인이 같은 번호를 쓰면 = 돌려쓰기 → 반려.
  const 원장키 = 'juksu_ledger_v40';
  const 시드키 = 'juksu_ledger_seeded_v40';
  const 원장읽기 = () => { try { return JSON.parse(G.get(원장키, '{}')) || {}; } catch (e) { return {}; } };
  const 원장쓰기 = o => G.set(원장키, JSON.stringify(o));
  // 최초 1회: 과거 검수 누적(juksu_accum)의 주문번호를 영구 원장으로 흡수 → 과거분도 커버
  const 원장시드 = () => {
    try {
      if (G.get(시드키, '') === '1') return;
      const L = 원장읽기(); const acc = 누적읽기(); let n = 0;
      Object.keys(acc).forEach(ck => {
        const 캠id = (String(ck).match(/A\d{6}/) || [ck])[0];
        (acc[ck].행 || []).forEach(r => {
          const 검수일 = acc[ck].날짜 || '';
          [숫자만(r[6]), 숫자만(r[7])].forEach(on => {
            if (on && on.length >= 8 && !L[on]) { L[on] = { 캠: 캠id, 이름: r[1] || '', 번호: r[0] || '', 주문일: r[12] || '', 검수일: 검수일, 판정: r[3] || '' }; n++; }
          });
        });
      });
      원장쓰기(L); G.set(시드키, '1');
      console.log('🌱 주문번호 영구 원장 시드 완료 — 과거 누적에서 ' + n + '개 흡수 (총 ' + Object.keys(L).length + '개)');
    } catch (e) { console.log('원장 시드 오류: ' + e); }
  };
  // 조회: 이 건의 제출/영수증 번호가 '다른 캠페인'에 이미 등록돼 있으면 그 원본 표시를 반환(같은 캠페인은 제외)
  const 원장크로스조회 = (d, 현재캠) => {
    const L = 원장읽기(); const 현재id = (String(현재캠).match(/A\d{6}/) || [현재캠])[0];
    const c = [숫자만(d.주문번호)]; if (d.판독 && d.판독.영수증주문번호) c.push(숫자만(d.판독.영수증주문번호));
    for (const on of c) { if (on && on.length >= 8 && L[on] && L[on].캠 && L[on].캠 !== 현재id) { const e = L[on]; return e.캠 + '·' + (e.이름 || '') + (e.검수일 ? '·' + e.검수일 : ''); } }
    return '';
  };
  // 등록: 이 건의 번호를 영구 원장에 기록(최초 등록 우선 — 이미 있으면 덮어쓰지 않음)
  const 원장등록 = (d, 캠, 검수일) => {
    const L = 원장읽기(); const 캠id = (String(캠).match(/A\d{6}/) || [캠])[0]; let 변동 = false;
    const c = [숫자만(d.주문번호)]; if (d.판독 && d.판독.영수증주문번호) c.push(숫자만(d.판독.영수증주문번호));
    [...new Set(c)].forEach(on => {
      if (on && on.length >= 8 && !L[on]) { L[on] = { 캠: 캠id, 이름: d.이름 || '', 번호: d.번호 || '', 주문일: (d.판독 && d.판독.주문일) || '', 검수일: 검수일 || '', 판정: d.판정 || '' }; 변동 = true; }
    });
    if (변동) 원장쓰기(L);
  };
  // 백업 파일 내보내기 (JSON) — 진짜 '영구'의 핵심: 브라우저/PC 소실 대비
  function 원장백업() {
    const L = 원장읽기(); const n = Object.keys(L).length;
    const b = new Blob([JSON.stringify({ _종류: 'maison_order_ledger', _버전: 40, _생성: new Date().toISOString(), 건수: n, 원장: L }, null, 0)], { type: 'application/json;charset=utf-8' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = '주문번호원장_백업_' + 스탬프오늘() + '.json';
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 3000);
    _알림('주문번호 원장 백업 완료\n\n총 ' + n + '개 주문번호\n파일: 주문번호원장_백업_' + 스탬프오늘() + '.json\n\n이 파일을 안전한 곳(드라이브 등)에 보관하세요.');
  }
  // 백업 파일 가져오기(복원) — 기존 원장과 합침(기존 우선, 없는 것만 추가)
  function 원장복원() {
    const inp = document.createElement('input'); inp.type = 'file'; inp.accept = '.json,application/json';
    inp.onchange = () => {
      const f = inp.files && inp.files[0]; if (!f) return;
      const rd = new FileReader();
      rd.onload = () => {
        try {
          const j = JSON.parse(rd.result); const src = (j && j.원장) ? j.원장 : j;
          if (!src || typeof src !== 'object') { _알림('원장 형식이 아닙니다.'); return; }
          const L = 원장읽기(); let 추가 = 0, 기존 = 0;
          Object.keys(src).forEach(on => { if (!L[on]) { L[on] = src[on]; 추가++; } else 기존++; });
          원장쓰기(L); G.set(시드키, '1'); 버튼갱신();
          _알림('원장 복원 완료\n\n새로 추가 ' + 추가 + '개 / 이미 있던 것 ' + 기존 + '개\n현재 총 ' + Object.keys(L).length + '개');
        } catch (e) { _알림('복원 실패: ' + String(e.message || e).slice(0, 80)); }
      };
      rd.readAsText(f);
    };
    inp.click();
  }
  const URL페이지 = () => Number(new URLSearchParams(location.search).get('page') || 1);
  // [v18] 주소 재인코딩으로 한글 필터가 깨지지 않게 page= 숫자만 문자열 치환
  const 페이지이동 = n => {
    let s = location.search;
    if (/[?&]page=\d+/.test(s)) s = s.replace(/([?&]page=)\d+/, '$1' + n);
    else s += (s ? '&' : '?') + 'page=' + n;
    location.href = location.pathname + s + location.hash;
  };

  const 다운로드 = (이름, 내용) => {
    const b = new Blob(['﻿' + 내용], { type: 'text/tab-separated-values;charset=utf-8' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = 이름;
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 3000);
  };
  const 스탬프오늘 = () => new Date().toISOString().slice(0, 10).replace(/-/g, '');

  /* ═════════ 설정 ═════════ */
  const 최대캠페인 = 0;   // 0 = 남은 전체 / 3 = 남은 것 중 앞 3개만(테스트)

  /* ═════════ 페이지 판별 ═════════ */
  const 상세매치 = location.pathname.match(/\/campaigns\/(\d{6,})/);
  const isDetail = !!상세매치;
  const isList = !isDetail && /\/campaigns\/?$/.test(location.pathname);

  /* ═════════ 메뉴 ═════════ */
  if (typeof GM_registerMenuCommand === 'function') {
    GM_registerMenuCommand('▶ 전체 자동검수 시작(목록에서)', () => 자동시작());
    GM_registerMenuCommand('🔍 이 캠페인만 검수', () => 검수실행());
    GM_registerMenuCommand('🚫 취소요청 일괄승인(이 캠페인)', () => 취소요청일괄승인());
    GM_registerMenuCommand('📦 전체 내보내기', () => 전체내보내기());
    GM_registerMenuCommand('⏹ 자동검수 중지', () => 자동중지());
    GM_registerMenuCommand('💾 주문번호 원장 백업(내보내기)', () => 원장백업());
    GM_registerMenuCommand('📥 주문번호 원장 복원(가져오기)', () => 원장복원());
    GM_registerMenuCommand('🗑 누적 초기화', () => 누적초기화());
    GM_registerMenuCommand('🔑 API 키 변경', () => { const k = prompt('새 API 키', G.get(키이름, '')); if (k !== null) { G.set(키이름, k.trim()); _알림('저장됨'); } });
  }

  /* ═════════ 버튼 패널 ═════════ */
  const 패널만들기 = () => {
    if (document.getElementById('__검수패널')) { 버튼갱신(); return; }
    if (!document.body) return;
    const box = document.createElement('div');
    box.id = '__검수패널';
    box.style.cssText = 'position:fixed;right:20px;bottom:110px;z-index:2147483647;display:flex;flex-direction:column;gap:8px;align-items:flex-end;font-family:sans-serif';
    const mk = (id, txt, bg, fn) => { const b = document.createElement('button'); b.id = id; b.textContent = txt; b.style.cssText = 'padding:11px 16px;background:' + bg + ';color:#fff;border:none;border-radius:10px;font-size:14px;font-weight:700;cursor:pointer;box-shadow:0 4px 14px rgba(0,0,0,.3);white-space:nowrap'; b.onclick = fn; return b; };
    const st = document.createElement('div'); st.id = '__상태줄'; st.style.cssText = 'font-size:12px;color:#fff;background:rgba(0,0,0,.6);padding:4px 10px;border-radius:8px;display:none'; box.appendChild(st);
    const pg = document.createElement('div'); pg.id = '__진행줄'; pg.style.cssText = 'font-size:12px;color:#fff;background:rgba(0,90,160,.9);padding:4px 10px;border-radius:8px;display:none'; box.appendChild(pg);
    if (isList) box.appendChild(mk('__시작버튼', '▶ 전체 자동검수 시작', '#0b5cad', () => 자동시작()));
    if (isDetail) box.appendChild(mk('__검수버튼', '🔍 이 캠페인만 검수', '#111', () => 검수실행()));
    if (isDetail) box.appendChild(mk('__취소승인버튼', '🚫 취소요청 일괄승인', '#c2410c', () => 취소요청일괄승인()));
    box.appendChild(mk('__내보내기버튼', '📦 전체 내보내기', '#1a7f45', () => 전체내보내기()));
    box.appendChild(mk('__원장백업버튼', '💾 주문번호 원장 백업', '#5b3fa0', () => 원장백업()));
    box.appendChild(mk('__원장복원버튼', '📥 원장 복원(가져오기)', '#3f5aa0', () => 원장복원()));
    box.appendChild(mk('__중지버튼', '⏹ 자동 중지', '#8a3b3b', () => 자동중지()));
    document.body.appendChild(box);
    버튼갱신();
  };
  const 진행 = (msg) => { const p = document.getElementById('__진행줄'); if (p) { p.style.display = msg ? 'block' : 'none'; p.textContent = msg || ''; } };
  const 버튼갱신 = () => {
    const n = Object.keys(누적읽기()).length;
    const eb = document.getElementById('__내보내기버튼'); if (eb) eb.textContent = '📦 전체 내보내기 (' + n + ')';
    const lb = document.getElementById('__원장백업버튼'); if (lb) { try { lb.textContent = '💾 주문번호 원장 백업 (' + Object.keys(원장읽기()).length + ')'; } catch (e) {} }
    const o = 오케읽기(); const st = document.getElementById('__상태줄');
    if (st) {
      if (o.mode === 'running') { st.style.display = 'block'; st.textContent = '⏳ 자동검수 ' + (o.idx + 1) + ' / ' + o.queue.length; }
      else if (o.mode === 'paused') { st.style.display = 'block'; st.textContent = '⏸ 일시중지 (' + (o.idx + 1) + '/' + o.queue.length + ') — 크레딧 확인 후 재시작'; }
      else st.style.display = 'none';
    }
  };
  const 준비 = () => { if (document.body) 패널만들기(); else return setTimeout(준비, 500); try { 원장시드(); } catch (e) {} 자동진행체크(); 수집진행체크(); };

  /* ═════════ 내보내기 / 초기화 ═════════ */
  function 전체내보내기() {
    const 누적 = 누적읽기(); const 캠목록 = Object.keys(누적);
    if (!캠목록.length) { _알림('누적된 검수 결과가 없습니다.'); return; }
    const 헤더 = 누적[캠목록[0]].헤더;
    const 처리필요판정 = ['조정필요', '조정불일치', '검증불일치', '보류', '반려'];
    const 통합 = ['캠페인\t' + 헤더], 필요 = ['캠페인\t' + 헤더], 요약들 = [];
    캠목록.forEach(캠 => { const rec = 누적[캠]; 요약들.push(rec.요약 || ('■ ' + 캠)); (rec.행 || []).forEach(r => { const line = 캠 + '\t' + r.join('\t'); 통합.push(line); if (처리필요판정.includes(r[3])) 필요.push(line); }); });
    const s = 스탬프오늘();
    다운로드('통합_판독표_' + s + '.tsv', 통합.join('\n'));
    다운로드('처리필요_' + s + '.tsv', 필요.join('\n'));
    다운로드('통합_요약_' + s + '.txt', 요약들.join('\n\n'));
    // [v29] 검수전 건 처리결과·사유 자동 보고 (왜 안됐는지 사유별 집계)
    const 진단행 = ['캠페인\t번호\t이름\t판정\t결과\t사유']; const 사유cnt = {};
    캠목록.forEach(캠 => (누적[캠].진단 || []).forEach(r => {
      진단행.push(r.join('\t'));
      let key = r[4];
      if (/실패|보류|검증불일치/.test(r[4])) key = r[4] + ' : ' + String(r[5]).replace(/\d+/g, 'N').slice(0, 45);
      사유cnt[key] = (사유cnt[key] || 0) + 1;
    }));
    다운로드('진단_검수전처리내역_' + s + '.tsv', 진단행.join('\n'));
    const 집계 = Object.entries(사유cnt).sort((a, b) => b[1] - a[1]).map(e => e[1] + '건\t' + e[0]);
    다운로드('진단_사유별집계_' + s + '.txt', ['■ 검수전 건 처리결과 사유별 집계 (자동 보고)', '  총 ' + (진단행.length - 1) + '건', ''].concat(집계).join('\n'));
    const 문제 = 문제읽기();
    if (문제.length) 다운로드('미완료_문제_' + s + '.txt', ['■ 자동검수 중 건너뛴/문제 캠페인 (' + 문제.length + '건)'].concat(문제.map(p => p.code + '\t' + p.reason)).join('\n'));
    _알림('내보내기 완료\n\n캠페인 ' + 캠목록.length + '개\n처리필요(조정·보류 등) ' + (필요.length - 1) + '건\n건너뜀/문제 ' + 문제.length + '건' + (문제.length ? ' (미완료_문제 파일 참고)' : '') + '\n\n담당자용은 "처리필요" 파일 하나면 됩니다.');
  }
  function 누적초기화() { const n = Object.keys(누적읽기()).length; if (!_확인('누적 ' + n + '개 결과 + 문제 기록을 모두 지울까요? (내보내기 먼저 했는지 확인)')) return; 누적쓰기({}); 문제비우기(); 버튼갱신(); _알림('초기화 완료'); }
  function 자동중지() { const o = 오케읽기(); o.mode = 'idle'; 오케쓰기(o); 수집쓰기({ active: false, codes: [], allcodes: [] }); 버튼갱신(); _알림('자동검수를 중지했습니다. (누적 결과는 유지)'); }

  /* ═════════ [v40.1] 취소요청 일괄승인 (이 캠페인) ═════════ */
  // 캠페인 상세에서 '선정 취소 요청' 버튼 → 모달의 '선정취소 승인' 클릭. 취소는 페이백 미지급이라 현금 손실 없음.
  let 취소처리중 = false;
  async function 취소요청일괄승인() {
    if (취소처리중) { _알림('이미 취소요청 처리 중입니다.'); return; }
    if (!isDetail) { _알림('캠페인 상세 페이지에서 실행하세요.\n(체험단 관리 → 취소요청 탭 → 캠페인 진입 후 이 버튼)'); return; }
    // 화면에 취소요청 버튼이 있는지 먼저 확인
    const 요청버튼찾기 = () => [...document.querySelectorAll('button,a,[role=button],span,div')]
      .find(e => e.offsetParent !== null && /^선정\s*취소\s*요청$/.test((e.textContent || '').trim()) && (e.textContent || '').replace(/\s/g, '').length <= 8);
    if (!요청버튼찾기()) { _알림('이 캠페인에 처리할 취소요청이 없습니다.\n(선정자 목록 맨 아래까지 스크롤한 뒤 다시 눌러보세요)'); return; }
    if (!_확인('이 캠페인의 선정취소 요청을 모두 [선정취소 승인] 처리합니다.\n\n· 취소는 본인이 신청 + 페이백 미지급이라 현금 손실이 없습니다.\n· 처리한 사람·사유는 파일로 저장됩니다.\n\n계속할까요?')) return;

    취소처리중 = true;
    const btn = document.getElementById('__취소승인버튼'); if (btn) { btn.disabled = true; btn.textContent = '⏳ 취소요청 처리 중…'; }
    const 로그 = []; let 처리 = 0, 실패 = 0;
    try {
      for (let guard = 0; guard < 60; guard++) {
        // 남은 취소요청 버튼까지 스크롤하며 탐색
        const trig = 요청버튼찾기();
        if (!trig) break;
        try { trig.scrollIntoView({ block: 'center' }); } catch (e) {}
        await sleep(400);
        trig.click(); await sleep(1300);   // 모달 열림
        // 모달에서 이름·사유 수집
        const 모달문 = document.body.innerText;
        const 이름 = (모달문.match(/([가-힣]{2,4})\s*님?\s*께서/) || [])[1] || (모달문.match(/([가-힣]{2,4})\s*님/) || [])[1] || '?';
        const 사유 = ((모달문.match(/이유로[\s\S]{0,40}?\n([^\n]{2,80})/) || [])[1] || '').trim();
        // 주황 '선정취소 승인' 버튼 대기 후 클릭 ('취소 거절'은 절대 누르지 않음)
        const 승인 = await 대기찾기(() => [...document.querySelectorAll('button,a,[role=button]')]
          .find(e => e.offsetParent !== null && /선정취소\s*승인|선정\s*취소\s*승인/.test((e.textContent || '').replace(/\s+/g, ' ')) && !/거절/.test(e.textContent || '')), 14, 500);
        if (!승인) {
          실패++; 로그.push([이름, '실패', '승인버튼 못찾음', 사유].join('\t'));
          // 모달 닫고 중단(무한루프 방지 — 같은 버튼이 계속 잡히면 위험)
          const x = V('×')[0]; if (x && x.offsetParent) x.click(); await sleep(800);
          break;
        }
        승인.click(); await sleep(1900);
        처리++; 로그.push([이름, '승인', '', 사유].join('\t'));
        console.log('🚫 취소승인: ' + 이름 + (사유 ? ' — ' + 사유 : ''));
        // 잔여 모달 정리
        const x = V('×')[0]; if (x && x.offsetParent) x.click(); await sleep(700);
      }
    } catch (e) { console.error(e); 로그.push(['-', '오류', String(e).slice(0, 60), ''].join('\t')); }
    finally {
      취소처리중 = false; if (btn) { btn.disabled = false; btn.textContent = '🚫 취소요청 일괄승인'; }
    }
    // 처리 내역 파일 저장
    if (로그.length) {
      const 캠 = (document.body.innerText.match(/(\d{16}A\d{6})/) || [''])[0];
      다운로드('취소요청_처리내역_' + (캠 || '캠페인') + '_' + 스탬프오늘() + '.tsv',
        ['이름\t결과\t비고\t사유'].concat(로그).join('\n'));
    }
    _알림('취소요청 처리 완료\n\n승인 ' + 처리 + '건 / 실패 ' + 실패 + '건\n\n처리 내역이 파일로 저장됐습니다.' + (실패 ? '\n\n⚠ 실패건은 화면에서 직접 확인해 주세요.' : ''));
  }

  /* ═════════ 오케스트레이터 ═════════ */
  // 현재 페이지 코드 긁기 (아래까지 스크롤)
  // [v24] 전체코드(전체set)와 '검수 필요' 코드(검수set)를 함께 수집. 페이지 순회는 전체set 증가 기준.
  const 페이지코드수집 = async (검수set, 전체set) => {
    let prev = -1, stable = 0;
    for (let i = 0; i < 40; i++) {
      window.scrollTo(0, document.documentElement.scrollHeight);
      await sleep(500);
      (document.body.innerText.match(/\d{16}A\d{6}/g) || []).forEach(c => 전체set.add(c));   // 전체(폴백용)
      // '리뷰 검수' 버튼이 있는 캠페인만(=검수 필요). 완료('리뷰 확인'/'결과 레포트')는 제외.
      [...document.querySelectorAll('button,a,[role=button],span,div,p')]
        .filter(e => e.offsetParent !== null && /리뷰\s*검수/.test(e.textContent || '') && (e.textContent || '').replace(/\s/g, '').length <= 12 && !/리뷰\s*확인/.test(e.textContent || ''))
        .forEach(btn => { let n = btn; for (let d = 0; d < 14 && n; d++) { n = n.parentElement; const m = ((n && n.innerText) || '').match(/\d{16}A\d{6}/); if (m) { 검수set.add(m[0]); break; } } });
      if (전체set.size === prev) { if (++stable >= 3) break; } else stable = 0;
      prev = 전체set.size;
    }
    window.scrollTo(0, 0); await sleep(300);
  };

  // [v17] 버튼: 주소의 page= 를 바꿔가며 전 페이지 수집 시작 (새로고침에도 이어짐)
  async function 자동시작() {
    if (!isList) { _알림('체험단 관리 "목록" 페이지에서 시작하세요.'); return; }
    const KEY = 키확보(); if (!KEY) return;
    const _버전 = (typeof GM_info !== 'undefined' && GM_info.script && GM_info.script.version) ? GM_info.script.version : '?';
    if (!_확인('검수 대상 수집을 시작합니다. (스크립트 버전 v' + _버전 + ')\n\n"리뷰 검수" 버튼이 있는 캠페인만 모읍니다(=검수전 리뷰가 남은 캠페인).\n이전에 검수했던 캠페인도 새 리뷰가 있으면 다시 들어가 검수전만 추가 검수합니다(검수완료는 건너뜀).\n\n계속할까요?')) return;
    수집쓰기({ active: true, codes: [], allcodes: [] });
    수집진행체크();   // 1페이지부터 시작
  }

  // 목록 페이지 로드 때마다: 수집 중이면 이 페이지 긁고 다음 페이지로
  let 수집중플래그 = false;
  async function 수집진행체크() {
    if (!isList) return;
    const cs = 수집읽기();
    if (!cs.active || 수집중플래그) return;
    if (차단감지()) return;   // [v41] 차단 감지 시 수집 중단
    수집중플래그 = true;
    try {
      const 시작버튼 = document.getElementById('__시작버튼');
      const 검수set = new Set(cs.codes);
      const 전체set = new Set(cs.allcodes || []);
      const before = 전체set.size;
      if (시작버튼) 시작버튼.textContent = '▶ 수집 중… ' + URL페이지() + '페이지';
      await 페이지코드수집(검수set, 전체set);
      cs.codes = [...검수set]; cs.allcodes = [...전체set];
      const added = 전체set.size - before;
      const 페이지 = URL페이지();
      수집쓰기(cs);
      if (시작버튼) 시작버튼.textContent = '▶ 수집 중… ' + 페이지 + '페이지 (검수필요 ' + cs.codes.length + ' / 전체 ' + cs.allcodes.length + ')';
      if ((added > 0 || 페이지 === 1) && 페이지 < 50) {   // [v41] 새 코드가 있으면 다음 페이지로 (최대 50p 안전상한 · 간격 상향)
        await sleep(2500); 페이지이동(페이지 + 1); return;
      }
      // 새 코드 0 → 마지막 페이지 지남 → 수집 완료. 검수필요 있으면 그것만, 없으면 전체로 폴백(항상 실행).
      cs.active = false; 수집쓰기(cs);
      const 대상 = (cs.codes && cs.codes.length) ? cs.codes : cs.allcodes;
      console.log('■ 수집 완료 — 검수필요 ' + (cs.codes || []).length + ' / 전체 ' + (cs.allcodes || []).length + ' → 큐 ' + 대상.length + '개' + (cs.codes.length ? '' : ' (검수필요 감지 실패 → 전체 폴백)'));
      빌드하고시작(대상);
    } finally { 수집중플래그 = false; }
  }

  function 빌드하고시작(codes) {
    codes = [...new Set(codes)];
    if (!codes.length) { _알림('캠페인을 하나도 못 찾았습니다.\n체험단 관리 "목록" 페이지에서 실행했는지 확인하세요.\n(F12 콘솔에 수집 로그가 찍힙니다.)'); return; }
    const done = 누적읽기();
    const 전체 = codes.length;
    // [v40.2] '리뷰 검수' 버튼으로 수집된 = 아직 검수전 리뷰가 남아 있는 캠페인. 이미 누적에 있어도 새 리뷰가 추가됐을 수 있으므로 건너뛰지 말고 재진입한다.
    //   (본체는 검수완료 리뷰를 자동으로 스킵하므로 중복 승인·반려 없음. 새 검수전만 처리.)
    let 남은 = codes;
    const 재검수수 = codes.filter(c => done[c]).length;   // 예전에 한 번 검수했던 캠페인 수(정보용)
    if (!남은.length) { _알림('수집된 검수 대상 캠페인이 없습니다.\n체험단 관리 "목록"에서 실행했는지 확인하세요.'); return; }
    let queue = 남은.map(c => ({ code: c, id: c.slice(0, 16), url: location.origin + '/trials/client/campaigns/' + c.slice(0, 16) }));
    if (최대캠페인 > 0) queue = queue.slice(0, 최대캠페인);
    if (!_확인('목록 수집 완료!\n\n검수 대상 ' + 전체 + '개 (새 검수전 리뷰가 있는 캠페인)\n  · 그중 이전에 검수했던 캠페인 ' + 재검수수 + '개 → 다시 들어가 새 리뷰만 추가 검수\n이번에 진행 ' + queue.length + '개' + (최대캠페인 > 0 ? ' (제한 ' + 최대캠페인 + ')' : '') + '\n\n각 캠페인에 자동 진입해 검수합니다.\n계속할까요?')) return;
    오케쓰기({ mode: 'running', queue, idx: 0 });
    location.href = queue[0].url;
  }

  /* ═════════ [v41] 접근차단 감지 → 즉시 정지 ═════════ */
  function 차단걸림(사유) {
    if (차단됨) return true;
    차단됨 = true;
    try { const o = 오케읽기(); if (o.mode === 'running') { o.mode = 'paused'; 오케쓰기(o); } } catch (e) {}
    try { 수집쓰기({ active: false, codes: [], allcodes: [] }); } catch (e) {}
    try { 버튼갱신(); } catch (e) {}
    try { console.error('⛔ [차단감지] 자동화 정지: ' + 사유); } catch (e) {}
    try { _알림('⛔ 스타일씨 접근 차단이 감지되어 자동화를 즉시 중단했습니다.\n\n사유: ' + 사유 + '\n\n같은 IP로 계속 시도하면 영구 차단될 수 있습니다.\n핫스팟/공유기로 IP를 바꾼 뒤 다시 시작하세요.'); } catch (e) {}
    return true;
  }
  function 차단감지() {
    try {
      if (차단됨) return true;
      const t = (document.body && document.body.innerText || '').slice(0, 4000);
      if (차단문구.test(t)) return 차단걸림('페이지 문구: ' + ((t.match(차단문구) || [''])[0]));
      if (_사이트마지막알림 && (Date.now() - _사이트마지막알림.t < 60000) && 차단문구.test(_사이트마지막알림.m)) return 차단걸림('사이트 알림');
    } catch (e) {}
    return false;
  }

  let 진행중 = false;
  async function 자동진행체크() {
    const o = 오케읽기();
    if (o.mode !== 'running' || !isDetail || 진행중) return;
    if (차단감지()) return;   // [v41] 차단 감지 시 진행 중단
    진행중 = true;
    await sleep(3500);          // 페이지 렌더 대기
    try {
      const KEY = 키확보(); if (!KEY) { 진행중 = false; return; }
      await 끝까지스크롤();
      const 현재코드 = (오케읽기().queue[오케읽기().idx] || {}).code;
      // [v13] 캠페인 15분 초과 시 건너뛰기 (예상 못한 멈춤 방지 · v21 자동반려로 소요 증가 반영)
      const status = await Promise.race([
        본체(KEY, { auto: true }),
        new Promise(r => setTimeout(() => r('__TIMEOUT__'), 30 * 60 * 1000))   // [v39] 대량 검수전 대비 15→30분
      ]);
      const cur = 오케읽기();
      if (status === 'creditlow') { cur.mode = 'paused'; 오케쓰기(cur); 버튼갱신(); _알림('⚠ 크레딧 부족으로 자동검수를 중단했습니다.\n\n' + (cur.idx + 1) + '/' + cur.queue.length + '번째에서 멈춤.\n크레딧 충전 후 "▶ 전체 자동검수 시작"을 다시 누르면 이어서 진행합니다.'); return; }
      if (status === 'modelfail') { cur.mode = 'paused'; 오케쓰기(cur); 버튼갱신(); _알림('⚠ 모델 ID 오류로 중단했습니다.\n\n1차 판독 모델(모델1차) 값이 거부되었습니다.\n스크립트 상단의 모델1차 를 다른 값(예: claude-haiku-5)으로 바꾸거나 확인해 주세요.\n콘솔(F12)에 실제 오류 메시지가 찍혀 있습니다.'); return; }
      if (status === '__TIMEOUT__') { 문제추가(현재코드, '15분 초과 → 건너뜀'); console.log('⏭ 시간초과 건너뜀: ' + 현재코드); }
      // 다음으로
      cur.idx += 1; 오케쓰기(cur); 버튼갱신();
      if (cur.idx < cur.queue.length) { if (차단감지()) return; await sleep(4000); location.href = cur.queue[cur.idx].url; }
      else { cur.mode = 'done'; 오케쓰기(cur); await sleep(500); 전체내보내기(); _알림('🎉 전체 자동검수 완료!\n\n총 ' + cur.queue.length + '개 캠페인 처리, 통합 파일이 다운로드됐습니다.'); }
    } catch (e) {
      console.error(e);
      const cur = 오케읽기();
      문제추가((cur.queue[cur.idx] || {}).code, '오류: ' + String(e && e.message).slice(0, 80));   // [v13] 오류도 기록 후 계속
      cur.idx += 1; 오케쓰기(cur);
      if (cur.idx < cur.queue.length) { if (차단감지()) return; await sleep(4000); location.href = cur.queue[cur.idx].url; }
      else { cur.mode = 'done'; 오케쓰기(cur); 전체내보내기(); }
    } finally { 진행중 = false; }
  }

  const 끝까지스크롤 = async () => {
    let prev = -1, stable = 0;
    for (let i = 0; i < 60; i++) { window.scrollTo(0, document.body.scrollHeight); await sleep(600); const n = V('리뷰 보기').length; if (n === prev) { if (++stable >= 3) break; } else stable = 0; prev = n; }
    window.scrollTo(0, 0); await sleep(300);
  };

  /* ═════════ 단일 검수(수동) ═════════ */
  let 실행중 = false;
  async function 검수실행() {
    if (!isDetail) { _알림('캠페인 상세 페이지에서 실행하세요.'); return; }
    if (실행중) { _알림('이미 검수 중입니다.'); return; }
    const KEY = 키확보(); if (!KEY) return;
    실행중 = true; const btn = document.getElementById('__검수버튼'); if (btn) { btn.disabled = true; btn.textContent = '⏳ 검수 중…'; }
    try { await 본체(KEY, { auto: false }); } catch (e) { console.error(e); _알림('오류: ' + (e && e.message)); }
    finally { 실행중 = false; if (btn) { btn.disabled = false; btn.textContent = '🔍 이 캠페인만 검수'; } 버튼갱신(); }
  }

  /* ══════════════════════════════════════════════════════════
     검수 본체 (반환: 'ok' | 'empty' | 'creditlow' | 'cancel')
     ══════════════════════════════════════════════════════════ */
  async function 본체(KEY, opts) {
    opts = opts || {};
    const 정가 = 28000, 자동승인 = true, 자동반려 = true, 테스트건수 = 0;
    // [v23] 지금은 정확도 우선: 1차·2차 모두 Sonnet. (나중에 비용절감 시 모델1차만 Haiku로 바꾸면 됨)
    const 모델1차 = 'claude-sonnet-5';
    const 모델2차 = 'claude-sonnet-5';
    const 모델 = 모델2차;   // 하위호환
    const 반려비율상한 = 0.30, 반려건수상한 = 15, 반려최소건수 = 5, 개별파일다운로드 = false;   // [v39] 반려최소건수 미만이면 비율상한 미적용(소규모 캠페인 오보류 방지)
    const 예외캠페인 = [];   // [v37] 이세연 예외 해제 — 이세연도 정상 검수(리뷰 캡처 없음이면 자동 반려). 다시 예외 필요하면 여기에 캠페인코드 추가.
    const 예외인물 = '이세연';   // (예외캠페인이 비어 있으면 미적용)
    const 문구규칙 = [
      { 조건: /주문번호 미입력/, 문구: '안녕하세요! 소중한 리뷰 남겨주셔서 진심으로 감사드립니다. 다만 쿠팡 주문번호가 입력되지 않아 확인이 어려워 부득이 반려되었어요. 쿠팡 [마이쿠팡 > 주문목록]에서 주문번호와 주문상세(영수증) 화면을 함께 올려주시면 바로 정상 승인해 드리겠습니다. 번거롭게 해드려 죄송하며, 참여해 주셔서 감사합니다!' },
      { 조건: /증빙없음|영수증 없음/, 문구: '안녕하세요! 체험단에 참여해 주셔서 진심으로 감사드립니다. 구매 영수증(주문상세) 캡쳐가 확인되지 않아 부득이 반려되었어요. 쿠팡 [마이쿠팡 > 주문목록 > 주문상세] 화면을 캡쳐해 다시 올려주시면 바로 정상 승인해 드리겠습니다. 조금만 보완 부탁드려요!' },
      { 조건: /타상품/, 문구: '안녕하세요! 소중한 참여 진심으로 감사드립니다. 제출해 주신 영수증이 다른 상품의 주문 내역으로 확인되어 부득이 반려되었어요. 쿠팡 [마이쿠팡 > 주문목록]에서 이번 체험 상품의 주문상세를 다시 캡쳐해 올려주시면 정상 승인해 드리겠습니다. 확인 부탁드리며 감사합니다!' },
      { 조건: /주문번호 불일치/, 문구: '안녕하세요! 참여해 주셔서 진심으로 감사드립니다. 입력하신 주문번호와 영수증의 주문번호가 서로 달라 부득이 반려되었어요. 두 번호를 한 번 더 확인하신 뒤 올바른 주문상세 화면과 함께 다시 제출해 주시면 바로 정상 승인해 드리겠습니다!' },
      { 조건: /주문번호 중복/, 문구: '안녕하세요! 참여해 주셔서 진심으로 감사드립니다. 동일한 주문번호가 중복으로 제출되어 부득이 반려되었어요. 체험단 건별로 각각 주문하신 주문번호가 맞는지 확인하신 뒤 다시 제출해 주시면 정상 승인해 드리겠습니다. 번거롭게 해드려 죄송합니다!' },
      { 조건: /리뷰 캡처 없음/, 문구: '안녕하세요! 정성껏 리뷰 작성해 주셔서 진심으로 감사드립니다. 실제 등록된 쿠팡 리뷰 화면이 확인되지 않아 부득이 반려되었어요. 작성하신 리뷰가 보이는 화면을 캡쳐해 함께 올려주시면 바로 정상 승인해 드리겠습니다. 조금만 보완 부탁드려요!' },
      { 조건: /.*/, 문구: '안녕하세요! 소중한 참여 진심으로 감사드립니다. 제출해 주신 증빙 확인이 어려워 부득이 반려되었어요. 구매 영수증(주문상세)과 작성하신 쿠팡 리뷰 화면을 다시 올려주시면 바로 정상 승인해 드리겠습니다. 번거롭게 해드려 죄송하며, 다시 한 번 감사드립니다!' }
    ];
    const 치명사유 = /증빙없음|주문번호 미입력|영수증 없음|타상품|주문번호 불일치|주문번호 중복|리뷰 캡처 없음/;

    const T = document.body.innerText;
    const 뽑 = re => { const m = T.match(re); return m ? m[1].replace(/\s+/g, ' ').trim() : ''; };
    const 캠 = 뽑(/(\d{16}A\d{6})/) || '';
    const 제목 = 뽑(/(\[[^\]]+\][^\n]*)/);
    const 기준페이백 = Number((뽑(/구매평\s*\(?\s*([\d,]+)\s*C/) || '0').replace(/,/g, '')) || 23000;
    const 오늘 = new Date().toISOString().slice(0, 10); const 스탬프 = 오늘.replace(/-/g, '');
    if (!캠) { if (!opts.auto) _알림('캠페인 코드를 찾지 못했습니다. 이 페이지가 캠페인 상세인지 확인하세요.'); return 'empty'; }
    console.log('■ ' + 캠 + ' | 페이백 ' + 기준페이백.toLocaleString() + 'C');
    if (!opts.auto) { if (!_확인('캠페인: ' + 캠 + '\n기준 페이백: ' + 기준페이백.toLocaleString() + 'C\n\n화면 값과 일치하면 확인.')) return 'cancel'; }

    const 행정보 = btn => {
      let n = btn, r = { 이름: '', 상태: '', 작성일시: '', 보상: 0 };
      for (let d = 0; d < 8 && n; d++) { n = n.parentElement; const t = n.innerText || ''; if (!r.상태) r.상태 = t.includes('검수 완료') ? '검수완료' : t.includes('검수 전') ? '검수전' : ''; if (r.상태) { if (!r.작성일시) r.작성일시 = (t.match(/(\d{2}\.\s?\d{2}\s+\d{2}:\d{2})\s*작성/) || [])[1] || ''; if (!r.보상) r.보상 = Number(((t.match(/([\d,]+)\s*C/) || [])[1] || '0').replace(/,/g, '')); if (!r.이름) r.이름 = 이름뽑기(t); } if (r.상태 && r.이름 && r.작성일시) break; }
      return r;
    };
    let 버튼 = V('리뷰 보기'); if (테스트건수 > 0) 버튼 = 버튼.slice(0, 테스트건수);
    if (!버튼.length) { if (!opts.auto) _알림('리뷰 목록이 없습니다. 목록 맨 아래까지 스크롤 후 다시 실행하세요.'); return 'empty'; }
    const 메타 = 버튼.map(행정보);
    console.log('■ 수집 ' + 버튼.length + '건');
    const D = [], seen = new Set();
    const 검수전총 = 메타.filter(m => m.상태 === '검수전').length;
    for (let i = 0; i < 버튼.length; i++) {
      // [v33] 검수완료는 상세를 열지 않는다(큰 캠페인 수집 타임아웃 방지). 검수전만 클릭해 주문번호·증빙 수집.
      if (메타[i].상태 === '검수완료') { D.push({ 번호: i + 1, ...메타[i], 주문번호: '', 증빙: [] }); continue; }
      진행('📥 수집(검수전) ' + (i + 1) + '/' + 버튼.length + ' [검수전 ' + 검수전총 + ']');
      버튼[i].click(); await sleep(1500);
      const 주문 = ((document.body.innerText.match(/주문번호\s*\n?\s*([\d\s]{8,})/) || [])[1] || '').replace(/\s/g, '');
      const 증빙 = [...new Set([...document.querySelectorAll('img')].map(m => m.src))].filter(u => u.includes('/data/mission/') && !seen.has(u));
      증빙.forEach(u => seen.add(u));
      D.push({ 번호: i + 1, ...메타[i], 주문번호: 주문, 증빙 });
      const x = V('×')[0]; if (x && x.offsetParent) x.click(); await sleep(700);
    }

    const 공통 = `{"영수증있음":true/false,"총결제금액":숫자|null,"영수증주문번호":"숫자"|null,"상품명":"문자"|null,"주문일":"YYYY-MM-DD"|null,"결제수단":"문자"|null,"쿠팡리뷰있음":true/false,"리뷰별점":숫자|null,"SNS게시물있음":true/false,"영수증상품메종여부":true/false,"비고":""}`;
    const 상품지침 = `\n영수증상품메종여부: '영수증/주문상세'에 찍힌 실제 구매 상품이 '메종원스이어 버터&헤이즐넛 쿠키'가 맞거나 판단이 애매하면 true로, 복싱세트·휴대폰·의류·전자제품 등 명백히 다른 상품이면 false로 표기하라. 리뷰 캡처에는 쿠키 후기가 있어도 '영수증'에 찍힌 상품이 다른 상품이면 false다 — 반드시 영수증(주문상세) 기준으로 판단하라. false일 때는 비고에 실제 영수증 상품명을 한 줄로 적어라.`;
    const 지시1 = `오늘은 ${오늘}이다. 이 날짜 이전은 모두 과거이므로 미래 날짜라고 지적하지 마라.\n쿠팡 체험단 참여자가 제출한 증빙 이미지다. 아래 JSON만 출력. 설명·마크다운 금지.\n${공통}\n비고는 아래 경우에만 한 줄로 적고, 그 외에는 반드시 빈 문자열로 두라.\n· 영수증 상품이 메종원스이어 쿠키가 아닌 다른 상품일 때(상품명 명시)\n· 이미지 조작이 의심되거나 판독 불가일 때\n주문일보다 리뷰 작성일이 늦은 것, 영수증에 상품명이 없는 것, 배송일과 리뷰일 간격은 정상이므로 지적하지 마라.${상품지침}`;
    const 지시2 = `기준일: ${오늘}. 그 이전 날짜는 과거이며 문제가 아니다.\n아래 이미지에서 결제 총액·주문번호·상품명·주문일·결제수단·쿠팡리뷰 캡처 여부·SNS 캡처 여부를 찾아 JSON 한 개로만 답하라. 다른 말 금지.\n출력 형식: ${공통}\n비고에는 '상품이 메종원스이어 쿠키가 아님' 또는 '판독 불가'인 경우만 적고 그 외 빈 문자열. 날짜 순서·상품명 누락은 적지 마라.${상품지침}`;

    let 크레딧부족 = false, 모델오류 = false;
    // [v38] 쿠팡/스타일씨 CDN 이미지는 브라우저 fetch가 CORS에 막힘 → GM_xmlhttpRequest로 blob 다운로드(우회)
    const GM이미지blob = (url) => new Promise((resolve) => {
      try {
        if (typeof GM_xmlhttpRequest !== 'function') return resolve(null);
        GM_xmlhttpRequest({ method: 'GET', url, responseType: 'blob', timeout: 20000, onload: r => resolve((r && r.response) || null), onerror: () => resolve(null), ontimeout: () => resolve(null) });
      } catch (e) { resolve(null); }
    });
    // [v37→v38] 크기초과 이미지를 canvas로 다운스케일해 base64로 반환(판독불가 → 자동 축소 재판독). GM 우회 우선, 실패 시 fetch.
    const 이미지축소base64 = async (url, maxpx = 1400) => {
      try {
        let blob = await GM이미지blob(url);
        if (!blob) { try { const resp = await fetch(url); if (resp.ok) blob = await resp.blob(); } catch (e) {} }
        if (!blob) return null;
        const bmp = await createImageBitmap(blob);
        let w = bmp.width, h = bmp.height; const scale = Math.min(1, maxpx / Math.max(w, h));
        w = Math.max(1, Math.round(w * scale)); h = Math.max(1, Math.round(h * scale));
        const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
        cv.getContext('2d').drawImage(bmp, 0, 0, w, h);
        try { bmp.close && bmp.close(); } catch (e) {}
        return cv.toDataURL('image/jpeg', 0.85).split(',')[1];
      } catch (e) { console.log('   ✗ 이미지 축소 실패: ' + String(e.message).slice(0, 80)); return null; }
    };
    const 판독하기 = async (urls, 지시, 모델선택) => {
      const 사용모델 = 모델선택 || 모델;
      let content = [...urls.map(u => ({ type: 'image', source: { type: 'url', url: u } })), { type: 'text', text: 지시 }];
      let 축소함 = false;
      for (let t = 0; t < 3; t++) {
        const ctrl = new AbortController();
        const _to = setTimeout(() => ctrl.abort(), 45000);   // [v11] 45초 타임아웃 → 무한 대기 방지
        try {
          const res = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', signal: ctrl.signal, headers: { 'x-api-key': KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json', 'anthropic-dangerous-direct-browser-access': 'true' }, body: JSON.stringify({ model: 사용모델, max_tokens: 1000, messages: [{ role: 'user', content }] }) });
          clearTimeout(_to);
          if (res.status === 429 || res.status === 529) { console.log('   ' + res.status + ' 과부하 → 20초 대기'); await sleep(20000); continue; }   // [v15] 529 과부하도 대기·재시도
          if (!res.ok) {
            const tx = await res.text();
            if (res.status === 400 && /credit balance/i.test(tx)) { 크레딧부족 = true; return '__CREDIT_LOW__'; }
            if (res.status === 400 && /image dimensions|max allowed size|exceed|too large/i.test(tx)) {
              // [v37] 크기초과 → 즉시 포기하지 않고 다운스케일 후 base64로 1회 재시도
              if (!축소함) {
                const b64 = []; for (const u of urls) { const d = await 이미지축소base64(u); if (d) b64.push({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: d } }); }
                if (b64.length) { content = [...b64, { type: 'text', text: 지시 }]; 축소함 = true; console.log('   ↻ 이미지 크기초과 → 축소 재판독(' + b64.length + '장)'); continue; }
              }
              console.log('   ✗ 이미지 크기초과(축소 실패) → 건너뜀'); return '__IMG_FAIL__';
            }
            if ((res.status === 400 || res.status === 404) && /model|not_found/i.test(tx) && !/credit/i.test(tx)) { 모델오류 = true; console.log('   ✗ 모델 ID 오류(' + 사용모델 + '): ' + tx.slice(0, 200)); return '__MODEL_FAIL__'; }   // [v22] 잘못된 모델 ID 즉시 중단
            console.log('   ✗ ' + res.status + ' ' + tx.slice(0, 200)); await sleep(2000); continue;
          }
          const j = await res.json(); const txt = j.content.filter(c => c.type === 'text').map(c => c.text).join('');
          return JSON.parse(txt.replace(/```json|```/g, '').trim());
        } catch (e) { clearTimeout(_to); console.log('   ✗ ' + (e.name === 'AbortError' ? '타임아웃(45초) 재시도' : String(e.message).slice(0, 150))); await sleep(2500); }
      }
      return null;
    };

    { const x0 = V('×')[0]; if (x0 && x0.offsetParent) x0.click(); await sleep(500); }   // [v11] 잔여 모달 닫기
    const 검수전수 = D.filter(d => d.상태 === '검수전').length;
    console.log('■ 1차 판독 — 전체 ' + D.length + '건 중 검수전 ' + 검수전수 + '건만 판독(검수완료는 스킵)');
    for (const d of D) {
      // [v23] 검수완료는 OCR 안 함(토큰 절약). 상태 불명('')은 안전하게 판독.
      if (d.상태 === '검수완료') { d.판정 = '검수완료'; d.스킵 = true; continue; }
      진행('🔎 판독 ' + d.번호 + '/' + D.length + ' (검수전만)');
      if (!d.증빙.length) { d.오류 = '증빙없음'; continue; }
      const r = await 판독하기(d.증빙, 지시1, 모델1차);
      if (r === '__CREDIT_LOW__') { break; }
      if (r === '__MODEL_FAIL__') { break; }
      if (r === '__IMG_FAIL__') { d.오류 = '이미지 크기초과(판독불가)'; continue; }
      d.판독 = r; if (!d.판독) d.오류 = '판독 실패';
      await sleep(2500);
    }
    if (모델오류) { console.log('■ 모델 ID 오류 — 중단'); return 'modelfail'; }
    if (크레딧부족) { console.log('■ 크레딧 부족 — 중단'); return 'creditlow'; }

    // [v36] 타상품(영수증 상품 불일치) 서술형 표현까지 탐지 — Cyfie·복싱세트·휴대폰 등 다른 상품 영수증 돌려막기를 자동 반려로 승격
    const 타상품표현 = /타상품|다른\s*상품|복싱|권투|글러브|휴대폰|핸드폰|HDMI|케이블|리뷰\s*날짜와\s*일치|아닌\s+\S.{0,20}?(리뷰|세트|상품)/;
    const 판정하기 = (d, p) => {
      const s = [];
      if (!d.주문번호) s.push('주문번호 미입력');
      if (d.중복) s.push('주문번호 중복');
      if (d.크로스중복) s.push('주문번호 중복(타캠페인 재사용: ' + d.크로스중복 + ')');   // [v36] 중복 당첨자 = 캠페인마다 고유 주문번호 필수
      if (d.오류) s.push(d.오류);
      if (p) {
        if (!p.영수증있음) s.push('영수증 없음');
        if (p.영수증주문번호 && d.주문번호) { const A = 숫자만(p.영수증주문번호), B = 숫자만(d.주문번호); if (A && B && A !== B) { const 거리 = 편집거리(A, B); if (거리 <= 2) s.push('주문번호 경고(OCR ' + A + '≠' + B + ' 편집거리' + 거리 + ')'); else s.push('주문번호 불일치'); } }
        if (p.영수증상품메종여부 === false) s.push('타상품: ' + ((p.상품명 && !/메종|원스이어|쿠키/.test(p.상품명)) ? p.상품명 : '영수증 상품이 메종 쿠키 아님'));   // [v36] AI 구조화 플래그 우선(상품명이 리뷰상품이면 일반문구)
        else if (p.상품명 && !/메종|원스이어|쿠키/.test(p.상품명)) s.push('타상품: ' + p.상품명);
        if (!p.쿠팡리뷰있음) s.push('리뷰 캡처 없음');
        if (p.비고) s.push(p.비고);
      }
      // [v36] 비고 등에 상품/날짜 불일치가 서술형으로 적혀 있고 아직 '타상품' 표식이 없으면 표식을 추가해 자동 반려로 승격
      if (타상품표현.test(s.join(' / ')) && !/타상품/.test(s.join(' / '))) s.push('타상품(영수증 상품 불일치)');
      const 사유 = s.join(' / '); const 결제 = p ? p.총결제금액 : null; let 판정;
      // [v30] 주문번호 OCR 편집거리 경고(≤2)는 오탐(사실상 정상) → 판정에서 제외. 기록(사유)에는 남김.
      const 판정용 = s.filter(x => !/^주문번호 경고\(OCR/.test(x)).join(' / ');
      if (판정용 && 치명사유.test(판정용)) 판정 = '반려';
      else if (판정용 || 결제 == null) 판정 = '보류';
      else if (결제 < 정가) { const 목표 = 기준페이백 - (정가 - 결제); 판정 = d.보상 < 기준페이백 ? (d.보상 === 목표 ? '조정완료' : '조정불일치') : '조정필요'; }
      else 판정 = d.상태 === '검수전' ? '승인대상' : '정상';
      return { 사유, 결제, 판정 };
    };
    const cnt = {}; D.forEach(d => { if (d.주문번호) cnt[d.주문번호] = (cnt[d.주문번호] || 0) + 1; });
    // [v40] 크로스 캠페인 돌려쓰기 탐지 — 영구 원장(독립 저장) 기준. 다른 캠페인에 이미 등록된 주문번호를 재사용하면 반려.
    //   v39는 누적(juksu_accum)에서 원장을 매번 새로 만들어 누적 초기화 시 소실됐음. v40은 영구 원장을 조회.
    D.forEach(d => { if (d.상태 === '검수완료') { d.판정 = '검수완료'; return; } d.중복 = cnt[d.주문번호] > 1; d.크로스중복 = 원장크로스조회(d, 캠); Object.assign(d, 판정하기(d, d.판독)); if (d.결제 != null && d.결제 < 정가) { d.할인 = 정가 - d.결제; d.목표 = 기준페이백 - d.할인; } });
    // [v40] 판정 후 이 캠페인의 검수전 건 주문번호를 영구 원장에 등록(최초 등록 우선). 다음 캠페인에서 재사용 시 돌려쓰기로 잡힘.
    D.forEach(d => { if (d.상태 === '검수전' && d.주문번호) 원장등록(d, 캠, 스탬프); });

    const 검증대상 = D.filter(d => ['승인대상', '반려', '조정필요', '조정완료'].includes(d.판정) && d.증빙.length);
    console.log('■ 2차 교차검증 ' + 검증대상.length + '건');
    let _vi = 0;
    for (const d of 검증대상) {
      진행('🔁 교차검증 ' + (++_vi) + '/' + 검증대상.length);
      let p2 = await 판독하기(d.증빙, 지시2, 모델2차);
      if (p2 === '__CREDIT_LOW__') break;
      if (p2 === '__MODEL_FAIL__') break;
      if (p2 === '__IMG_FAIL__') p2 = null;   // [v15] 크기초과 → 2차 실패로 처리(보류)
      d.판독2 = p2;
      if (!p2) { d.검증 = '2차실패'; d.판정 = '보류'; d.사유 = (d.사유 ? d.사유 + ' / ' : '') + '2차 판독 실패'; }
      else if (d.판정 === '반려' && 판정하기(d, p2).판정 === '반려') { d.검증 = '일치'; }   // [v37] 치명 반려는 금액과 무관 — 2차도 반려면 확정(금액불일치로 검증불일치 강등 방지 → 박송아형 자동반려)
      else { const r2 = 판정하기(d, p2); const A = 숫자만(p2.영수증주문번호), B = 숫자만((d.판독 || {}).영수증주문번호); const 주문일치 = (!A || !B) ? true : (A === B || 편집거리(A, B) <= 2); const 일치 = r2.판정 === d.판정 && String(p2.총결제금액) === String(d.결제) && 주문일치; d.검증 = 일치 ? '일치' : '불일치'; if (!일치) { d.판정 = '검증불일치'; d.사유 = (d.사유 ? d.사유 + ' / ' : '') + '1차 ' + d.결제 + '원 vs 2차 ' + p2.총결제금액 + '원'; } }
      await sleep(2500);
    }
    if (모델오류) return 'modelfail';
    if (크레딧부족) return 'creditlow';

    const GG = k => D.filter(d => d.판정 === k);
    let 승인목록 = 자동승인 ? GG('승인대상').concat(GG('조정완료').filter(d => d.상태 === '검수전')) : [];
    let 반려목록 = 자동반려 ? GG('반려').filter(d => d.상태 === '검수전') : [];
    const 경보 = [];
    // [v28] 예외캠페인이어도 '이세연' 개인만 자동 승인·반려에서 제외(수동 28,000). 나머지 리뷰어는 정상 자동처리.
    if (예외캠페인.some(c => 캠.includes(c))) {
      const 전 = 승인목록.length + 반려목록.length;
      승인목록 = 승인목록.filter(d => d.이름 !== 예외인물);
      반려목록 = 반려목록.filter(d => d.이름 !== 예외인물);
      if (전 !== 승인목록.length + 반려목록.length) 경보.push('예외 인물(' + 예외인물 + ') 자동처리 제외 — 수동 28,000원 승인 필요');
    }
    if (반려목록.length >= 반려최소건수 && 반려목록.length / Math.max(D.length, 1) > 반려비율상한) { 경보.push('반려 비율 상한 초과(' + 반려목록.length + '건) → 반려 보류'); 반려목록 = []; }
    if (반려목록.length > 반려건수상한) { 경보.push('반려 ' + 반려목록.length + '건 상한 초과 → 반려 보류'); 반려목록 = []; }

    const 행찾기 = 이름 => { for (const el of V('검수 전')) { let n = el, b = null, nm = ''; for (let x = 0; x < 8 && n; x++) { n = n.parentElement; if (!b) b = V('리뷰 보기', n)[0]; if (!nm) nm = 이름뽑기(n.innerText); if (b && nm) break; } if (b && nm === 이름) return b; } return null; };
    const 전송찾기 = () => { const c = [...document.querySelectorAll('button,a,[role=button],div,span')].filter(e => e.offsetParent !== null && /리뷰\s*반려\s*&/.test(e.textContent || '')); if (!c.length) return null; return c.sort((a, b) => a.querySelectorAll('*').length - b.querySelectorAll('*').length)[0]; };
    const 활성 = el => el && !el.disabled && !el.hasAttribute('disabled') && !/disabled/i.test(el.className || '') && getComputedStyle(el).pointerEvents !== 'none';

    const 작업목록 = [...승인목록.map(d => ({ d, 작업: '승인' })), ...반려목록.map(d => ({ d, 작업: '반려' }))];
    const 로그 = []; let 승인 = 0, 반려 = 0, 실패 = 0; let _ji = 0;
    for (const job of 작업목록) {
      진행('✅ 승인/반려 처리 ' + (++_ji) + '/' + 작업목록.length);
      const d = job.d;
      try {
      const b = 행찾기(d.이름);
      if (!b) { 실패++; 로그.push([d.번호, d.이름, job.작업, '실패', '행 못찾음'].join('\t')); continue; }
      b.click(); await sleep(2500);
      const 모달주문 = ((document.body.innerText.match(/주문번호\s*\n?\s*([\d\s]{8,})/) || [])[1] || '').replace(/\s/g, '');
      if (d.주문번호 && 모달주문 && 모달주문 !== d.주문번호) { 실패++; 로그.push([d.번호, d.이름, job.작업, '중단', '주문번호 불일치'].join('\t')); const x0 = V('×')[0]; if (x0 && x0.offsetParent) x0.click(); await sleep(1000); continue; }
      if (job.작업 === '승인') {
        const ok = await 대기찾기(() => V('리뷰 승인')[0], 16, 500);   // [v32] 리뷰 승인 버튼이 뜰 때까지 대기(타이밍 실패 방지)
        if (!ok) { 실패++; 로그.push([d.번호, d.이름, '승인', '실패', '승인버튼 없음'].join('\t')); }
        else { ok.click(); await sleep(2500); const 확정 = await 대기찾기(() => V('승인').filter(e => e !== ok).pop()); if (확정) { 확정.click(); await sleep(3500); 승인++; 로그.push([d.번호, d.이름, '승인', '성공', ''].join('\t')); console.log('✅ ' + d.이름); } else { 실패++; 로그.push([d.번호, d.이름, '승인', '실패', '확정버튼 없음'].join('\t')); const no = V('아니요')[0]; if (no) no.click(); await sleep(1000); } }
      } else {
        // [v38] 반려 = wr_no 로드 대기 → Vue 호출 → confirmed=-1 + 에러알림 캡처. 실패 시 모달 다시 열어 1회 재시도(일회성 타이밍 복구).
        const 문구 = 문구규칙.find(r => r.조건.test(d.사유 || 'x')).문구; let 결과 = '실패', 비고 = '';
        const _doc = (typeof unsafeWindow !== 'undefined' && unsafeWindow) ? unsafeWindow.document : document;
        const _win = (typeof unsafeWindow !== 'undefined' && unsafeWindow) ? unsafeWindow : window;
        const getVue = () => { try { const el = _doc.getElementById('campaignView'); if (el && el.__vue__) return el.__vue__; } catch (e) {} try { if (_win.page) return _win.page; } catch (e) {} return null; };
        const 에러문구re = /에러|실패|오류|불가|없습|초과|권한|다시|처리.*못/;
        for (let 시도 = 0; 시도 < 2 && 결과 !== '성공'; 시도++) {
          if (시도 > 0) {   // 재시도: 열린 모달 닫고 이 사람 리뷰 다시 열기
            try { const x = V('×')[0]; if (x && x.offsetParent) x.click(); } catch (e) {}
            await sleep(1300);
            const b2 = 행찾기(d.이름); if (b2) { b2.click(); await sleep(2600); }
            console.log('↻ 반려 재시도(' + d.이름 + ')');
          }
          try {
            // 모달이 이 사람 리뷰로 실제 로드될 때까지 wr_no 대기(로드 전 제출 → 서버 실패 방지)
            let vue = null;
            for (let t = 0; t < 16; t++) { vue = getVue(); if (vue && vue.iframeObj && vue.iframeObj.wr_no) break; await sleep(600); }
            if (vue && vue.iframeObj && vue.iframeObj.wr_no) {
              const wr전 = String(vue.iframeObj.wr_no);
              _사이트마지막알림 = null; const T0 = Date.now();
              try { vue.claimType = '반려'; vue.handleContentReason = 문구; vue.checkedPolicyGongjung = true; vue.handleContent('submit'); }
              catch (e) { 비고 = '직접호출오류:' + String(e).slice(0, 40); }
              let ok = false, 서버에러 = '';
              for (let t = 0; t < 20; t++) {
                await sleep(700);
                try { if (String(vue.iframeObj.confirmed) === '-1') { ok = true; break; } } catch (e) {}
                if (_사이트마지막알림 && _사이트마지막알림.t >= T0 && 에러문구re.test(_사이트마지막알림.m)) { 서버에러 = _사이트마지막알림.m; break; }
              }
              if (!서버에러 && _사이트마지막알림 && _사이트마지막알림.t >= T0 && 에러문구re.test(_사이트마지막알림.m)) 서버에러 = _사이트마지막알림.m;
              if (ok && !서버에러) { 결과 = '성공'; 비고 = ''; console.log('🚫 반려 완료(vue): ' + d.이름 + ' [wr_no ' + wr전 + ']' + (시도 > 0 ? ' (재시도)' : '')); }
              else { 결과 = '실패'; 비고 = 서버에러 ? ('사이트에러: ' + 서버에러.slice(0, 60)) : (비고 || ('confirmed=' + (vue.iframeObj ? vue.iframeObj.confirmed : '?'))); console.log('❗ 반려 미완(' + d.이름 + ', 시도' + (시도 + 1) + '): confirmed=' + (vue.iframeObj ? vue.iframeObj.confirmed : '?') + ' / 사이트에러=' + (서버에러 || '없음')); }
            } else {
              결과 = '실패'; 비고 = '모달 미로드(wr_no 없음)'; console.log('❗ 반려 미완(' + d.이름 + ', 시도' + (시도 + 1) + '): 리뷰 모달(wr_no) 로드 실패');
            }
          } catch (e) { 결과 = '실패'; 비고 = '반려오류:' + String(e).slice(0, 40); }
        }
        if (결과 === '성공') 반려++; else 실패++;
        로그.push([d.번호, d.이름, '반려', 결과, 비고 || 문구.slice(0, 30)].join('\t'));
      }
      } catch (e) {
        실패++; 로그.push([d.번호, d.이름, job.작업, '오류', String(e).slice(0, 60)].join('\t'));
        console.log('❗ 작업 오류(' + d.이름 + '): ' + e);
      } finally {
        // [v21] 남은 모달/에러창 강제 정리 후 다음 건 진행
        try { const x = V('×')[0]; if (x && x.offsetParent) x.click(); } catch (e2) {}
        try { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', keyCode: 27, which: 27, bubbles: true })); } catch (e2) {}
        await sleep(1200);
      }
    }

    // [v29] 검수전 각 건 최종 결과·사유 자동 진단 (완성체 보고용)
    const 액션맵 = {};
    로그.forEach(l => { const p = l.split('\t'); 액션맵[p[1]] = { 작업: p[2], 결과: p[3], 비고: p[4] || '' }; });
    const 예외적용 = 예외캠페인.some(c => 캠.includes(c));
    const 진단 = D.filter(d => d.상태 === '검수전').map(d => {
      const a = 액션맵[d.이름]; let R = '', 사유 = '';
      if (예외적용 && d.이름 === 예외인물) { R = '예외-수동승인'; 사유 = '협의 28,000원 수동 승인'; }
      else if (d.판정 === '승인대상' || d.판정 === '조정완료') { if (a && /성공/.test(a.결과)) { R = '완료-승인'; } else { R = '실패-승인'; 사유 = (a && a.비고) || '승인버튼 미실행'; } }
      else if (d.판정 === '반려') { if (a && /성공/.test(a.결과)) { R = '완료-반려'; } else { R = '담당자전달-반려필요'; 사유 = d.사유 || (a && a.비고) || '반려 대상(수동)'; } }
      else if (d.판정 === '조정필요') { R = '담당자전달-페이백조정'; 사유 = '결제 ' + d.결제 + ' → 목표 ' + (d.목표 ?? ''); }
      else if (d.판정 === '조정불일치') { R = '담당자전달-조정재확인'; 사유 = '조정액 목표와 불일치'; }
      else if (d.판정 === '검증불일치') { R = '담당자전달-검증불일치'; 사유 = d.사유 || '1·2차 불일치'; }
      else if (d.판정 === '보류') { R = '보류-확인필요'; 사유 = d.사유 || '확인 필요'; }
      else { R = d.판정 || '기타'; 사유 = d.사유 || ''; }
      return [캠, d.번호, d.이름, d.판정, R, 사유];
    });

    const 요약arr = ['■ ' + 캠 + ' · ' + 오늘 + ' · 전체 ' + D.length + '건', '  승인 ' + 승인 + ' / 반려 ' + 반려 + ' / 실패 ' + 실패, '  조정필요 ' + GG('조정필요').length + ' / 조정불일치 ' + GG('조정불일치').length + ' / 검증불일치 ' + GG('검증불일치').length + ' / 보류 ' + GG('보류').length + ' / 정상 ' + GG('정상').length + ' / 조정완료 ' + GG('조정완료').length];
    경보.forEach(w => 요약arr.push('  ⚠ ' + w));
    ['조정필요', '조정불일치', '검증불일치', '보류'].forEach(k => { if (!GG(k).length) return; 요약arr.push('── ' + k + ' ──'); GG(k).forEach(d => 요약arr.push('  ' + d.번호 + ' ' + d.이름 + ' [' + d.상태 + '] ' + (k === '조정필요' ? '결제 ' + d.결제 + ' → 페이백 ' + d.목표 : d.사유 || ''))); });

    const 판독헤더 = '번호\t이름\t상태\t판정\t검증\t사유\t제출주문번호\t영수증주문번호\t결제금액\t현재페이백\t조정페이백\t상품명\t주문일\t결제수단\t리뷰\tSNS';
    const 판독행렬 = D.map(d => { const p = d.판독 || {}; return [d.번호, d.이름, d.상태, d.판정, d.검증 || '', d.사유, d.주문번호, p.영수증주문번호 || '', d.결제 ?? '', d.보상, d.목표 ?? '', p.상품명 || '', p.주문일 || '', p.결제수단 || '', p.쿠팡리뷰있음 ? 'O' : 'X', p.SNS게시물있음 ? 'O' : 'X']; });

    const 누적 = 누적읽기(); 누적[캠] = { 날짜: 스탬프, 제목, 기준페이백, 헤더: 판독헤더, 요약: 요약arr.join('\n'), 행: 판독행렬, 진단: 진단 }; 누적쓰기(누적); 버튼갱신();

    if (개별파일다운로드) {
      다운로드('03_판독표_' + 캠 + '_' + 스탬프 + '.tsv', [판독헤더].concat(판독행렬.map(r => r.join('\t'))).join('\n'));
    }
    console.log(요약arr.join('\n'));
    if (!opts.auto) _알림('검수 완료 · ' + 캠 + '\n승인 ' + 승인 + ' / 반려 ' + 반려 + ' / 실패 ' + 실패 + '\n조정필요 ' + GG('조정필요').length + ' / 보류 ' + GG('보류').length + '\n\n누적 저장됨.');
    return 'ok';
  }

  /* ═════════ 시작 (모든 선언 이후 마지막에 호출) ═════════ */
  준비();
  setInterval(패널만들기, 3000);
})();