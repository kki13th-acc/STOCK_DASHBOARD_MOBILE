(function () {
  const TAB_TITLES = {
    kr: "KR Signals",
    us: "US Briefing",
    closing: "Closing Bet Proxy"
  };

  const DIRECT_CONFIG = { base: 58, w5: 3.2, w20: 1.1, min: 30, max: 95 };
  const TTL = {
    kr: 30 * 60 * 1000,
    us: 30 * 60 * 1000,
    closing: 6 * 60 * 60 * 1000
  };

  const KR_UNIVERSE = [
    ["005930.KS", "005930", "Samsung Electronics", "KOSPI"],
    ["000660.KS", "000660", "SK Hynix", "KOSPI"],
    ["035420.KS", "035420", "NAVER", "KOSPI"],
    ["005380.KS", "005380", "Hyundai Motor", "KOSPI"],
    ["051910.KS", "051910", "LG Chem", "KOSPI"],
    ["068270.KS", "068270", "Celltrion", "KOSPI"],
    ["035720.KQ", "035720", "Kakao", "KOSDAQ"],
    ["247540.KQ", "247540", "EcoPro BM", "KOSDAQ"]
  ];

  const US_UNIVERSE = [
    ["AAPL", "AAPL"],
    ["MSFT", "MSFT"],
    ["NVDA", "NVDA"],
    ["AMZN", "AMZN"],
    ["META", "META"],
    ["GOOGL", "GOOGL"],
    ["TSLA", "TSLA"],
    ["AMD", "AMD"]
  ];

  const state = { tab: "kr" };

  function q(id) {
    return document.getElementById(id);
  }

  function setText(id, text) {
    const el = q(id);
    if (el) el.textContent = text;
  }

  function clamp(n, lo, hi) {
    return Math.max(lo, Math.min(hi, n));
  }

  function pct(curr, prev) {
    if (!Number.isFinite(curr) || !Number.isFinite(prev) || prev === 0) return 0;
    return ((curr - prev) / prev) * 100;
  }

  function toGrade(score) {
    if (score >= 85) return "S";
    if (score >= 72) return "A";
    if (score >= 60) return "B";
    return "C";
  }

  function toAction(grade) {
    if (grade === "S" || grade === "A") return "BUY";
    if (grade === "B") return "HOLD";
    return "WAIT";
  }

  function cacheKey(tab) {
    return `aido_standalone_${tab}`;
  }

  function writeCache(tab, payload) {
    try {
      localStorage.setItem(cacheKey(tab), JSON.stringify({ saved_at: new Date().toISOString(), payload }));
    } catch (_) {}
  }

  function readCache(tab) {
    try {
      const raw = localStorage.getItem(cacheKey(tab));
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed || !parsed.payload) return null;
      const t = Date.parse(parsed.saved_at || "");
      if (!Number.isFinite(t)) return null;
      if ((Date.now() - t) > TTL[tab]) return null;
      return parsed.payload;
    } catch (_) {
      return null;
    }
  }

  const Progress = {
    open() {
      q("progress-panel").classList.remove("hidden");
    },
    close() {
      q("progress-panel").classList.add("hidden");
    },
    start(title, total, tabKey) {
      this.open();
      this.total = total;
      this.done = 0;
      this.failed = 0;
      this.running = 0;
      q("progress-title").textContent = title;
      q("progress-tab").textContent = (tabKey || "-").toUpperCase();
      q("progress-current").textContent = "-";
      q("progress-summary").textContent = `0/${total} completed`;
      q("progress-criteria-text").textContent =
        "score = 58 + (5D*3.2) + (1M*1.1), grade S>=85 A>=72 B>=60 C";
      q("progress-list").innerHTML = "";
      this.setBar(0);
    },
    setBar(percent) {
      const p = clamp(percent, 0, 100);
      q("progress-bar").style.width = `${p}%`;
      q("progress-aria").setAttribute("aria-valuenow", String(Math.round(p)));
    },
    setCurrent(text) {
      q("progress-current").textContent = text || "-";
    },
    step(label) {
      const container = q("progress-list");
      const id = `p-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
      const html = `
        <div class="p-item" id="${id}">
          <div class="p-top">
            <div class="p-label">${label}</div>
            <div class="p-state running">RUNNING</div>
          </div>
          <div class="p-detail">waiting...</div>
        </div>`;
      container.insertAdjacentHTML("beforeend", html);
      this.running += 1;
      this.setCurrent(label);
      return id;
    },
    update(id, status, detail) {
      const el = document.getElementById(id);
      if (!el) return;
      const st = el.querySelector(".p-state");
      const dt = el.querySelector(".p-detail");
      if (st) {
        st.textContent = status;
        st.className = "p-state " + (status === "DONE" ? "done" : status === "FAIL" ? "fail" : "running");
      }
      if (dt) dt.textContent = detail || "";
      if (status === "DONE") this.done += 1;
      if (status === "FAIL") this.failed += 1;
      if (status === "DONE" || status === "FAIL") this.running = Math.max(0, this.running - 1);
      const completed = this.done + this.failed;
      q("progress-summary").textContent = `${completed}/${this.total} completed | fail=${this.failed}`;
      this.setBar((completed / Math.max(1, this.total)) * 100);
      if (this.running === 0) this.setCurrent("-");
    },
    finish(note) {
      const msg = note || "Update completed.";
      q("progress-summary").textContent = `${q("progress-summary").textContent} | ${msg}`;
      this.setBar(100);
      this.setCurrent("-");
    }
  };

  async function fetchYahooChart(symbol, range, interval) {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=${range}&interval=${interval}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP_${res.status}`);
    const raw = await res.json();
    const result = (((raw || {}).chart || {}).result || [])[0] || {};
    const quote = (((result.indicators || {}).quote || [])[0] || {});
    const closes = (quote.close || []).filter((v) => Number.isFinite(v));
    if (!closes.length) throw new Error("EMPTY_CLOSE");
    return closes;
  }

  function parseCsvClose(csvText) {
    const text = String(csvText || "").trim();
    if (!text) return [];
    const lines = text.split(/\r?\n/).filter(Boolean);
    if (lines.length < 2) return [];
    const header = lines[0].split(",").map((x) => x.trim().toLowerCase());
    const closeIdx = header.indexOf("close");
    if (closeIdx < 0) return [];
    const rows = [];
    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].split(",");
      if (!cols.length) continue;
      const n = Number(String(cols[closeIdx] || "").replaceAll(",", ""));
      if (Number.isFinite(n) && n > 0) rows.push(n);
    }
    return rows;
  }

  async function fetchStooqChart(symbol) {
    const s = `${String(symbol || "").toLowerCase()}.us`;
    const url = `https://stooq.com/q/d/l/?s=${encodeURIComponent(s)}&i=d`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`STOOQ_HTTP_${res.status}`);
    const txt = await res.text();
    const closes = parseCsvClose(txt);
    if (!closes.length) throw new Error("STOOQ_EMPTY_CLOSE");
    return closes;
  }

  async function fetchFinnhubChart(symbol, token) {
    const tk = String(token || "").trim();
    if (!tk) throw new Error("NO_FINNHUB_KEY");
    const to = Math.floor(Date.now() / 1000);
    const from = to - (90 * 24 * 60 * 60);
    const url = `https://finnhub.io/api/v1/stock/candle?symbol=${encodeURIComponent(symbol)}&resolution=D&from=${from}&to=${to}&token=${encodeURIComponent(tk)}`;
    const res = await fetch(url);
    if (!res.ok) {
      let body = "";
      try {
        body = await res.text();
      } catch (_) {}
      const hint = res.status === 403 ? "INVALID_KEY_OR_PLAN" : "HTTP_FAIL";
      throw new Error(`FINNHUB_HTTP_${res.status}_${hint}${body ? `:${body.slice(0, 80)}` : ""}`);
    }
    const raw = await res.json();
    if (!raw || raw.s !== "ok" || !Array.isArray(raw.c)) throw new Error(`FINNHUB_${(raw && raw.s) || "EMPTY"}`);
    const closes = raw.c.filter((v) => Number.isFinite(v) && v > 0);
    if (!closes.length) throw new Error("FINNHUB_EMPTY_CLOSE");
    return closes;
  }

  async function fetchAlphaVantageChart(symbol, token) {
    const tk = String(token || "").trim();
    if (!tk) throw new Error("NO_ALPHAVANTAGE_KEY");
    const url = `https://www.alphavantage.co/query?function=TIME_SERIES_DAILY&symbol=${encodeURIComponent(symbol)}&outputsize=compact&apikey=${encodeURIComponent(tk)}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`ALPHAVANTAGE_HTTP_${res.status}`);
    const raw = await res.json();
    if (raw && raw["Note"]) throw new Error("ALPHAVANTAGE_RATE_LIMIT");
    if (raw && raw["Error Message"]) throw new Error(`ALPHAVANTAGE_ERROR:${raw["Error Message"]}`);
    const ts = raw && raw["Time Series (Daily)"];
    if (!ts || typeof ts !== "object") throw new Error("ALPHAVANTAGE_EMPTY");
    const dates = Object.keys(ts).sort();
    const closes = dates
      .map((d) => Number((ts[d] && ts[d]["4. close"]) || ""))
      .filter((v) => Number.isFinite(v) && v > 0);
    if (!closes.length) throw new Error("ALPHAVANTAGE_EMPTY_CLOSE");
    return closes;
  }

  function parseKrxRows(payload) {
    if (Array.isArray(payload)) return payload;
    if (!payload || typeof payload !== "object") return [];
    if (Array.isArray(payload.OutBlock_1)) return payload.OutBlock_1;
    if (payload.output && Array.isArray(payload.output)) return payload.output;
    if (payload.response && payload.response.body) {
      const body = payload.response.body;
      if (Array.isArray(body.items)) return body.items;
      if (Array.isArray(body.item)) return body.item;
    }
    if (Array.isArray(payload.data)) return payload.data;
    if (Array.isArray(payload.result)) return payload.result;
    return [];
  }

  function krxCodeFromRow(row) {
    return String(
      row.ISU_CD ||
      row.ISU_SRT_CD ||
      row.ISU_ABBRV ||
      row.MKT_ID ||
      ""
    ).padStart(6, "0");
  }

  function krxCloseFromRow(row) {
    const raw =
      row.TDD_CLSPRC ||
      row.CLSPRC ||
      row.CLS_PRC ||
      row.close ||
      row.Close ||
      "";
    const n = Number(String(raw).replaceAll(",", ""));
    return Number.isFinite(n) && n > 0 ? n : null;
  }

  function candidateDates(days) {
    const out = [];
    const now = new Date();
    for (let i = 0; i < days; i++) {
      const d = new Date(now.getTime() - (i * 24 * 60 * 60 * 1000));
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, "0");
      const dd = String(d.getDate()).padStart(2, "0");
      out.push(`${y}${m}${dd}`);
    }
    return out;
  }

  async function fetchKrxRows(path, basDd, authKey) {
    const url = `https://data-dbg.krx.co.kr${path}?basDd=${encodeURIComponent(basDd)}`;
    const res = await fetch(url, { headers: { AUTH_KEY: authKey } });
    if (!res.ok) throw new Error(`KRX_HTTP_${res.status}`);
    const data = await res.json();
    return parseKrxRows(data);
  }

  async function fetchKrxSnapshot(authKey, targetCodes) {
    if (!authKey) return { ok: false, reason: "NO_KRX_KEY", basDd: null, map: {} };
    const wanted = new Set((targetCodes || []).map((x) => String(x).padStart(6, "0")));
    const dates = candidateDates(10);
    const paths = ["/svc/apis/sto/stk_bydd_trd", "/svc/apis/sto/ksq_bydd_trd"];
    let lastErr = "KRX_UNKNOWN";

    for (const basDd of dates) {
      try {
        const [kospi, kosdaq] = await Promise.all([
          fetchKrxRows(paths[0], basDd, authKey),
          fetchKrxRows(paths[1], basDd, authKey)
        ]);
        const all = [...kospi, ...kosdaq];
        if (!all.length) {
          lastErr = `KRX_EMPTY_${basDd}`;
          continue;
        }
        const map = {};
        for (const row of all) {
          const code = krxCodeFromRow(row);
          if (!wanted.has(code)) continue;
          const close = krxCloseFromRow(row);
          if (!Number.isFinite(close)) continue;
          map[code] = { close, raw: row };
        }
        return { ok: true, reason: "KRX_OK", basDd, map };
      } catch (e) {
        lastErr = e.message || "KRX_FETCH_FAIL";
      }
    }

    return { ok: false, reason: lastErr, basDd: null, map: {} };
  }

  async function fetchKrxHistory(authKey, targetCodes, minPoints) {
    if (!authKey) {
      return { ok: false, reason: "NO_KRX_KEY", latestDate: null, latestMap: {}, historyMap: {} };
    }

    const wanted = new Set((targetCodes || []).map((x) => String(x).padStart(6, "0")));
    const historyMap = {};
    wanted.forEach((code) => {
      historyMap[code] = [];
    });

    const dates = candidateDates(60);
    const paths = ["/svc/apis/sto/stk_bydd_trd", "/svc/apis/sto/ksq_bydd_trd"];
    let latestDate = null;
    let latestMap = {};
    let lastErr = "KRX_HISTORY_UNKNOWN";

    for (const basDd of dates) {
      try {
        const [kospi, kosdaq] = await Promise.all([
          fetchKrxRows(paths[0], basDd, authKey),
          fetchKrxRows(paths[1], basDd, authKey)
        ]);
        const all = [...kospi, ...kosdaq];
        let hitToday = 0;

        const todayMap = {};
        for (const row of all) {
          const code = krxCodeFromRow(row);
          if (!wanted.has(code)) continue;
          const close = krxCloseFromRow(row);
          if (!Number.isFinite(close)) continue;
          historyMap[code].push({ basDd, close, raw: row });
          todayMap[code] = { close, raw: row };
          hitToday += 1;
        }

        if (hitToday > 0 && !latestDate) {
          latestDate = basDd;
          latestMap = todayMap;
        }

        const enough = Array.from(wanted).every((code) => (historyMap[code] || []).length > minPoints);
        if (enough) {
          return {
            ok: true,
            reason: "KRX_OK",
            latestDate,
            latestMap,
            historyMap
          };
        }
      } catch (e) {
        lastErr = e.message || "KRX_HISTORY_FAIL";
      }
    }

    const anyData = Array.from(wanted).some((code) => (historyMap[code] || []).length > 1);
    if (!anyData) {
      return { ok: false, reason: lastErr, latestDate, latestMap, historyMap };
    }

    return { ok: true, reason: "KRX_PARTIAL", latestDate, latestMap, historyMap };
  }

  function renderList(items, subtitle) {
    q("tab-status").textContent = subtitle;
    const html = items.map((it) => {
      const rcls = it.ret5 >= 0 ? "up" : "down";
      return `
      <article class="item">
        <div class="item-top">
          <div>
            <div class="item-name">${it.name}</div>
            <div class="item-sub">${it.code} | ${it.market || "-"}${it.krxStatus ? ` | KRX ${it.krxStatus}${Number.isFinite(it.krxClose) ? `(${it.krxClose})` : ""}` : ""}</div>
          </div>
          <div class="item-score">Score ${it.score} (${it.grade})</div>
        </div>
        <div class="item-sub ${rcls}">5D ${it.ret5 >= 0 ? "+" : ""}${it.ret5.toFixed(2)}% | 1M ${it.ret20 >= 0 ? "+" : ""}${it.ret20.toFixed(2)}%</div>
        <div class="item-reason">${it.action} | ${it.reason}</div>
      </article>`;
    }).join("");
    q("content").innerHTML = html || `<div class="tiny">No data.</div>`;
  }

  async function buildKR() {
    const macro = Progress.step("KRX history check");
    const keys = await SecureVault.load();
    const krxKey = (keys && keys.KRX_AUTH_KEY) || "";
    const krx = await fetchKrxHistory(krxKey, KR_UNIVERSE.map((x) => x[1]), 20);
    if (krx.ok) {
      const latest = krx.latestDate || "-";
      const matched = Object.keys(krx.latestMap || {}).length;
      Progress.update(macro, "DONE", `KRX latest=${latest} | matched=${matched} | mode=${krx.reason}`);
    } else {
      Progress.update(macro, "FAIL", krx.reason);
    }

    const rows = [];
    const globalReason = krx.ok ? "" : krx.reason;
    for (const [symbol, code, name, market] of KR_UNIVERSE) {
      const sid = Progress.step(`KR ${code} ${name}`);
      try {
        const hist = (krx.historyMap && krx.historyMap[code]) || [];
        if (hist.length < 2) throw new Error("KRX_NO_HISTORY");
        const last = hist[0].close;
        const p5 = hist[Math.min(5, hist.length - 1)].close;
        const p20 = hist[Math.min(20, hist.length - 1)].close;
        const r5 = pct(last, p5);
        const r20 = pct(last, p20);
        const score = clamp(Math.round(DIRECT_CONFIG.base + (r5 * DIRECT_CONFIG.w5) + (r20 * DIRECT_CONFIG.w20)), DIRECT_CONFIG.min, DIRECT_CONFIG.max);
        const grade = toGrade(score);
        const action = toAction(grade);
        const c5 = r5 * DIRECT_CONFIG.w5;
        const c20 = r20 * DIRECT_CONFIG.w20;
        const krxHit = (krx.latestMap && krx.latestMap[code]) || null;
        const krxStatus = krx.ok ? (krxHit ? "OK" : "STALE") : "UNAVAILABLE";
        rows.push({
          code,
          name,
          market,
          score,
          grade,
          action,
          ret5: r5,
          ret20: r20,
          krxStatus,
          krxClose: krxHit ? krxHit.close : null,
          reason: `KRX model | 5D ${r5.toFixed(2)}%, 1M ${r20.toFixed(2)}%`
        });
        Progress.update(
          sid,
          "DONE",
          `score=${score} = 58 + (${r5.toFixed(2)}*3.2=${c5.toFixed(2)}) + (${r20.toFixed(2)}*1.1=${c20.toFixed(2)}) | grade=${grade} | action=${action} | KRX=${krxStatus}${krxHit ? ` close=${krxHit.close}` : ""}`
        );
      } catch (e) {
        const reason = `${e.message}${globalReason ? ` | ${globalReason}` : ""}`;
        rows.push({
          code,
          name,
          market,
          score: 30,
          grade: "C",
          action: "WAIT",
          ret5: 0,
          ret20: 0,
          krxStatus: "UNAVAILABLE",
          krxClose: null,
          reason: `KRX unavailable | ${reason}`
        });
        Progress.update(sid, "FAIL", reason);
      }
    }
    rows.sort((a, b) => b.score - a.score);
    return rows;
  }

  async function buildUS() {
    const keys = await SecureVault.load();
    const finnhubKey = String((keys && keys.FINNHUB_API_KEY) || "").trim();
    const avKey = String((keys && keys.ALPHAVANTAGE_API_KEY) || "").trim();

    const macroId = Progress.step("US Macro SPY/QQQ/DIA/IWM/VIX");
    let fg = 50;
    let macroReason = "";
    try {
      const [spy, qqq, dia, iwm] = await Promise.all([
        fetchFinnhubChart("SPY", finnhubKey),
        fetchFinnhubChart("QQQ", finnhubKey),
        fetchFinnhubChart("DIA", finnhubKey),
        fetchFinnhubChart("IWM", finnhubKey)
      ]);
      const s5 = pct(spy[spy.length - 1], spy[Math.max(0, spy.length - 6)]);
      const q5 = pct(qqq[qqq.length - 1], qqq[Math.max(0, qqq.length - 6)]);
      const d5 = pct(dia[dia.length - 1], dia[Math.max(0, dia.length - 6)]);
      const i5 = pct(iwm[iwm.length - 1], iwm[Math.max(0, iwm.length - 6)]);
      fg = clamp(Math.round(55 + ((s5 + q5 + d5 + i5) / 4) * 3), 5, 95);
      Progress.update(macroId, "DONE", `FearGreed=${fg} | src=FINNHUB`);
    } catch (e) {
      try {
        const [spy, qqq, dia, iwm] = await Promise.all([
          fetchAlphaVantageChart("SPY", avKey),
          fetchAlphaVantageChart("QQQ", avKey),
          fetchAlphaVantageChart("DIA", avKey),
          fetchAlphaVantageChart("IWM", avKey)
        ]);
        const s5 = pct(spy[spy.length - 1], spy[Math.max(0, spy.length - 6)]);
        const q5 = pct(qqq[qqq.length - 1], qqq[Math.max(0, qqq.length - 6)]);
        const d5 = pct(dia[dia.length - 1], dia[Math.max(0, dia.length - 6)]);
        const i5 = pct(iwm[iwm.length - 1], iwm[Math.max(0, iwm.length - 6)]);
        fg = clamp(Math.round(55 + ((s5 + q5 + d5 + i5) / 4) * 3), 5, 95);
        Progress.update(macroId, "DONE", `FearGreed=${fg} | src=ALPHAVANTAGE`);
      } catch (avErr) {
        macroReason = `${e.message} | ${avErr.message}`;
        Progress.update(macroId, "FAIL", macroReason);
      }
    }

    const picks = [];
    for (const [symbol, name] of US_UNIVERSE) {
      const sid = Progress.step(`US ${symbol}`);
      try {
        let closes = [];
        let source = "FINNHUB";
        try {
          closes = await fetchFinnhubChart(symbol, finnhubKey);
        } catch (fErr) {
          closes = await fetchAlphaVantageChart(symbol, avKey);
          source = "ALPHAVANTAGE";
          if (!closes.length) throw new Error(`${fErr.message} | ALPHAVANTAGE_EMPTY_CLOSE`);
        }
        const last = closes[closes.length - 1];
        const r5 = pct(last, closes[Math.max(0, closes.length - 6)]);
        const r20 = pct(last, closes[0]);
      const score = clamp(Math.round(DIRECT_CONFIG.base + (r5 * DIRECT_CONFIG.w5) + (r20 * DIRECT_CONFIG.w20)), DIRECT_CONFIG.min, DIRECT_CONFIG.max);
      const grade = toGrade(score);
      const action = toAction(grade);
      const c5 = r5 * DIRECT_CONFIG.w5;
      const c20 = r20 * DIRECT_CONFIG.w20;
      picks.push({ code: symbol, name, market: "US", score, grade, action, ret5: r5, ret20: r20, reason: `FearGreed ${fg} | Direct proxy model | src=${source}` });
      Progress.update(
        sid,
        "DONE",
        `score=${score} = 58 + (${r5.toFixed(2)}*3.2=${c5.toFixed(2)}) + (${r20.toFixed(2)}*1.1=${c20.toFixed(2)}) | grade=${grade} | action=${action} | src=${source}`
      );
      } catch (e) {
        const reason = `${e.message}${macroReason ? ` | macro=${macroReason}` : ""}`;
        picks.push({
          code: symbol,
          name,
          market: "US",
          score: 30,
          grade: "C",
          action: "WAIT",
          ret5: 0,
          ret20: 0,
          reason: `US unavailable | ${reason}`
        });
        Progress.update(sid, "FAIL", reason);
      }
    }
    picks.sort((a, b) => b.score - a.score);
    return picks;
  }

  async function buildClosing() {
    const macro = Progress.step("Closing KRX history check");
    const keys = await SecureVault.load();
    const krxKey = (keys && keys.KRX_AUTH_KEY) || "";
    const krx = await fetchKrxHistory(krxKey, KR_UNIVERSE.map((x) => x[1]), 20);
    if (krx.ok) {
      const latest = krx.latestDate || "-";
      const matched = Object.keys(krx.latestMap || {}).length;
      Progress.update(macro, "DONE", `KRX latest=${latest} | matched=${matched} | mode=${krx.reason}`);
    } else {
      Progress.update(macro, "FAIL", krx.reason);
    }

    const rows = [];
    const globalReason = krx.ok ? "" : krx.reason;
    for (const [symbol, code, name, market] of KR_UNIVERSE) {
      const sid = Progress.step(`Closing ${code} ${name}`);
      try {
        const hist = (krx.historyMap && krx.historyMap[code]) || [];
        if (hist.length < 2) throw new Error("KRX_NO_HISTORY");
        const last = hist[0].close;
        const p5 = hist[Math.min(5, hist.length - 1)].close;
        const p20 = hist[Math.min(20, hist.length - 1)].close;
        const r5 = pct(last, p5);
        const r20 = pct(last, p20);
        const score = clamp(Math.round(DIRECT_CONFIG.base + (r5 * DIRECT_CONFIG.w5) + (r20 * DIRECT_CONFIG.w20)), DIRECT_CONFIG.min, DIRECT_CONFIG.max);
        const grade = toGrade(score);
        const action = toAction(grade);
        const c5 = r5 * DIRECT_CONFIG.w5;
        const c20 = r20 * DIRECT_CONFIG.w20;
        const krxHit = (krx.latestMap && krx.latestMap[code]) || null;
        const krxStatus = krx.ok ? (krxHit ? "OK" : "STALE") : "UNAVAILABLE";
        rows.push({
          code,
          name,
          market,
          score,
          grade,
          action,
          ret5: r5,
          ret20: r20,
          krxStatus,
          krxClose: krxHit ? krxHit.close : null,
          reason: `Closing KRX model | 5D ${r5.toFixed(2)}%, 1M ${r20.toFixed(2)}%`
        });
        Progress.update(
          sid,
          "DONE",
          `score=${score} = 58 + (${r5.toFixed(2)}*3.2=${c5.toFixed(2)}) + (${r20.toFixed(2)}*1.1=${c20.toFixed(2)}) | grade=${grade} | action=${action} | KRX=${krxStatus}${krxHit ? ` close=${krxHit.close}` : ""}`
        );
      } catch (e) {
        const reason = `${e.message}${globalReason ? ` | ${globalReason}` : ""}`;
        rows.push({
          code,
          name,
          market,
          score: 30,
          grade: "C",
          action: "WAIT",
          ret5: 0,
          ret20: 0,
          krxStatus: "UNAVAILABLE",
          krxClose: null,
          reason: `Closing KRX unavailable | ${reason}`
        });
        Progress.update(sid, "FAIL", reason);
      }
    }
    rows.sort((a, b) => b.score - a.score);
    return rows;
  }

  function totalSteps(tab) {
    if (tab === "us") return 1 + US_UNIVERSE.length;
    if (tab === "kr") return 1 + KR_UNIVERSE.length;
    return 1 + KR_UNIVERSE.length;
  }

  async function loadTab(tab) {
    q("tab-title").textContent = TAB_TITLES[tab];
    q("content").innerHTML = `<div class="tiny">Loading...</div>`;

    Progress.start(`${TAB_TITLES[tab]} Update`, totalSteps(tab), tab);
    let directError = null;
    try {
      let data;
      if (tab === "kr") data = await buildKR();
      else if (tab === "us") data = await buildUS();
      else data = await buildClosing();

      if (!data.length) throw new Error("NO_DIRECT_ROWS");

      writeCache(tab, data);
      renderList(data.slice(0, 8), `Mode: DIRECT | Updated ${new Date().toLocaleTimeString("ko-KR")}`);
      setText("global-mode", "DIRECT");
      Progress.finish("DIRECT completed");
      return;
    } catch (e) {
      directError = e;
      Progress.finish(`DIRECT failed: ${e.message}`);
    }

    const cached = readCache(tab);
    if (cached) {
      renderList(cached.slice(0, 8), "Mode: CACHE | DIRECT unavailable");
      setText("global-mode", "CACHE");
      return;
    }
    const reason = (directError && directError.message) ? directError.message : "unknown";
    const tips = [
      "1) 인터넷 연결 확인 (ONLINE 배지 확인)",
      "2) 다른 네트워크(핫스팟)로 재시도",
      "3) 새로고침 후 Refresh 재실행",
      "4) 첫 성공 후에는 CACHE 모드 사용 가능"
    ].join("<br>");
    q("tab-status").textContent = "Mode: UNAVAILABLE";
    q("content").innerHTML = `
      <div class="item">
        <div class="item-name">데이터를 불러오지 못했습니다</div>
        <div class="item-sub">DIRECT 실패 원인: ${reason}</div>
        <div class="item-reason">${tips}</div>
      </div>`;
    setText("global-mode", "UNAVAILABLE");
  }

  function updateNow() {
    setText("now", new Date().toLocaleString("ko-KR"));
    setText("device-meta", `${window.innerWidth}x${window.innerHeight} | DPR ${window.devicePixelRatio || 1}`);
  }

  function updateNet() {
    const online = navigator.onLine;
    const el = q("net-badge");
    el.textContent = online ? "ONLINE" : "OFFLINE";
    el.className = `badge ${online ? "online" : "offline"}`;
  }

  const SecureVault = {
    dbName: "solo-secure-store",
    version: 1,
    keyStore: "keyring",
    dataStore: "cipher",

    openDb() {
      return new Promise((resolve, reject) => {
        const req = indexedDB.open(this.dbName, this.version);
        req.onupgradeneeded = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains(this.keyStore)) db.createObjectStore(this.keyStore);
          if (!db.objectStoreNames.contains(this.dataStore)) db.createObjectStore(this.dataStore);
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    },

    idbGet(db, storeName, key) {
      return new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, "readonly");
        const store = tx.objectStore(storeName);
        const req = store.get(key);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    },

    idbPut(db, storeName, key, value) {
      return new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, "readwrite");
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.objectStore(storeName).put(value, key);
      });
    },

    idbDelete(db, storeName, key) {
      return new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, "readwrite");
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.objectStore(storeName).delete(key);
      });
    },

    bytesToB64(bytes) {
      let bin = "";
      for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
      return btoa(bin);
    },

    b64ToBytes(b64) {
      const bin = atob(b64);
      const out = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
      return out;
    },

    async getOrCreateMasterKey(db) {
      const existing = await this.idbGet(db, this.keyStore, "master_key");
      if (existing) return existing;
      const key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
      await this.idbPut(db, this.keyStore, "master_key", key);
      return key;
    },

    async save(keys) {
      const db = await this.openDb();
      try {
        const master = await this.getOrCreateMasterKey(db);
        const iv = crypto.getRandomValues(new Uint8Array(12));
        const plain = new TextEncoder().encode(JSON.stringify(keys || {}));
        const cipher = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, master, plain);
        await this.idbPut(db, this.dataStore, "api_keys", {
          updated_at: new Date().toISOString(),
          iv_b64: this.bytesToB64(iv),
          cipher_b64: this.bytesToB64(new Uint8Array(cipher))
        });
      } finally {
        db.close();
      }
    },

    async load() {
      const db = await this.openDb();
      try {
        const rec = await this.idbGet(db, this.dataStore, "api_keys");
        if (!rec) return null;
        const master = await this.idbGet(db, this.keyStore, "master_key");
        if (!master) return null;
        const iv = this.b64ToBytes(rec.iv_b64 || "");
        const cipher = this.b64ToBytes(rec.cipher_b64 || "");
        if (!iv.length || !cipher.length) return null;
        const plainBuf = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, master, cipher);
        const txt = new TextDecoder().decode(plainBuf);
        return JSON.parse(txt || "{}");
      } catch (_) {
        return null;
      } finally {
        db.close();
      }
    },

    async clear() {
      const db = await this.openDb();
      try {
        await this.idbDelete(db, this.dataStore, "api_keys");
      } finally {
        db.close();
      }
    }
  };

  function mask(v) {
    const s = (v || "").trim();
    if (!s) return "NONE";
    if (s.length <= 8) return "*".repeat(s.length);
    return `${s.slice(0, 4)}${"*".repeat(s.length - 8)}${s.slice(-4)}`;
  }

  async function syncKeyStatus(runtimeLoaded) {
    const loaded = await SecureVault.load();
    const o = (loaded && loaded.OPENAI_API_KEY) || "";
    const g = (loaded && loaded.GOOGLE_API_KEY) || "";
    const k = (loaded && loaded.KRX_AUTH_KEY) || "";
    const f = (loaded && loaded.FINNHUB_API_KEY) || "";
    const a = (loaded && loaded.ALPHAVANTAGE_API_KEY) || "";
    const text = `OPENAI=${mask(o)} | GOOGLE=${mask(g)} | KRX=${mask(k)} | FINNHUB=${mask(f)} | AV=${mask(a)} | runtime=${runtimeLoaded ? "LOADED" : "IDLE"}`;
    setText("keys-status", text);
    const settingsStatus = q("settings-status");
    if (settingsStatus) settingsStatus.textContent = text;
  }

  function openSettings() {
    q("settings-screen").classList.remove("hidden");
  }

  function closeSettings() {
    q("settings-screen").classList.add("hidden");
  }

  function bindEvents() {
    q("refresh").addEventListener("click", () => loadTab(state.tab));

    q("settings-open").addEventListener("click", openSettings);
    q("settings-close").addEventListener("click", closeSettings);

    q("keys-load").addEventListener("click", async () => {
      const loaded = await SecureVault.load();
      q("settings-openai-key").value = (loaded && loaded.OPENAI_API_KEY) || "";
      q("settings-google-key").value = (loaded && loaded.GOOGLE_API_KEY) || "";
      q("settings-krx-key").value = (loaded && loaded.KRX_AUTH_KEY) || "";
      q("settings-finnhub-key").value = (loaded && loaded.FINNHUB_API_KEY) || "";
      q("settings-av-key").value = (loaded && loaded.ALPHAVANTAGE_API_KEY) || "";
      await syncKeyStatus(true);
    });

    q("keys-save").addEventListener("click", async () => {
      await SecureVault.save({
        OPENAI_API_KEY: (q("settings-openai-key").value || "").trim(),
        GOOGLE_API_KEY: (q("settings-google-key").value || "").trim(),
        KRX_AUTH_KEY: (q("settings-krx-key").value || "").trim(),
        FINNHUB_API_KEY: (q("settings-finnhub-key").value || "").trim(),
        ALPHAVANTAGE_API_KEY: (q("settings-av-key").value || "").trim()
      });
      q("settings-openai-key").value = "";
      q("settings-google-key").value = "";
      q("settings-krx-key").value = "";
      q("settings-finnhub-key").value = "";
      q("settings-av-key").value = "";
      await syncKeyStatus(false);
      closeSettings();
    });

    q("keys-clear").addEventListener("click", async () => {
      await SecureVault.clear();
      await syncKeyStatus(false);
      q("settings-openai-key").value = "";
      q("settings-google-key").value = "";
      q("settings-krx-key").value = "";
      q("settings-finnhub-key").value = "";
      q("settings-av-key").value = "";
    });

    q("progress-toggle").addEventListener("click", () => {
      q("progress-panel").classList.toggle("hidden");
    });
    q("progress-close").addEventListener("click", () => {
      Progress.close();
    });

    document.querySelectorAll(".tab").forEach((tabBtn) => {
      tabBtn.addEventListener("click", () => {
        document.querySelectorAll(".tab").forEach((x) => x.classList.remove("active"));
        tabBtn.classList.add("active");
        state.tab = tabBtn.getAttribute("data-tab");
        loadTab(state.tab);
      });
    });

    window.addEventListener("online", updateNet);
    window.addEventListener("offline", updateNet);
    window.addEventListener("resize", updateNow);
  }

  async function registerSW() {
    if (!("serviceWorker" in navigator)) return;
    try {
      await navigator.serviceWorker.register("./sw.js");
    } catch (_) {}
  }

  async function init() {
    updateNow();
    setInterval(updateNow, 1000);
    updateNet();
    bindEvents();
    await syncKeyStatus(false);
    await registerSW();
    await loadTab(state.tab);
  }

  document.addEventListener("DOMContentLoaded", init);
})();

