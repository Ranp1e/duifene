// ==UserScript==
// @name         对分易自动答题助手
// @namespace    https://github.com/duifene-auto-answer
// @version      7.0.1
// @description  对分易自动答题 v7 — Shadow DOM 全新UI · 问答题真实保存接口(redit_essay_question) · 已答跳过 · 保存结果验证
// @author       duifene-helper
// @match        https://www.duifene.com/*
// @grant        GM_xmlhttpRequest
// @grant        GM_setValue
// @grant        GM_getValue
// @connect      api.deepseek.com
// @connect      www.duifene.com
// @license      MIT
// ==/UserScript==

(function () {
    'use strict';

    // ==================== 配置 ====================
    const K = {
        KEY: 'dfx_key', MODEL: 'dfx_model', DELAY: 'dfx_delay',
        AUTO_SUBMIT: 'dfx_asub', AUTO_RETURN: 'dfx_aret', SKIP_DONE: 'dfx_skip',
        SHORTCUT: 'dfx_sc', CACHE: 'dfx_cache', POS: 'dfx_pos', LOCK: 'dfx_lock'
    };
    const D = { MODEL: 'deepseek-chat', DELAY: 2000, AUTO_SUBMIT: false, AUTO_RETURN: true, SKIP_DONE: true, SHORTCUT: true };
    const getCfg = k => { const v = GM_getValue(k); return v !== undefined ? v : D[k]; };
    const setCfg = (k, v) => GM_setValue(k, v);

    // 从 v6 迁移旧配置（一次性）
    (function migrate() {
        if (GM_getValue(K.KEY) === undefined && GM_getValue('df48_key') !== undefined) {
            setCfg(K.KEY, GM_getValue('df48_key'));
            setCfg(K.MODEL, GM_getValue('df48_model') || D.MODEL);
            setCfg(K.DELAY, GM_getValue('df48_delay') || D.DELAY);
            if (GM_getValue('df48_cache') !== undefined) setCfg(K.CACHE, GM_getValue('df48_cache'));
        }
    })();

    const VERSION = '7.0.1';
    const DISCLAIMER = '本脚本仅用于用户本人已获授权的学习、练习与自测页面，用于辅助整理答案、填充草稿和保存进度。本脚本默认不自动提交最终试卷，不绕过考试、监考、验证码、防作弊或权限机制。使用者应遵守所在学校、平台及法律法规。脚本按"现状"提供，不保证答案正确、不保证兼容所有网站，不承担因使用本脚本导致的成绩、账号、纪律、法律或经济后果。API Key 由使用者自行保管，调用大模型可能产生费用。首次使用前请确认你已获得相关授权并同意自行承担风险。';

    // ==================== 工具 ====================
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    function stripHtml(s) { const d = document.createElement('div'); d.innerHTML = s; return d.textContent || ''; }
    function clean(s) { return (s || '').replace(/[\s 　]+/g, '').replace(/[，,]/g, ',').replace(/[；;]/g, ';').replace(/[（）()]/g, '').replace(/[""''「」『』《》<>]/g, '').toLowerCase().trim(); }
    function hashKey(q, t) { const s = q.replace(/\s+/g, ' ').trim() + '|' + t; let h = 0; for (let i = 0; i < s.length; i++) { h = ((h << 5) - h) + s.charCodeAt(i); h |= 0; } return 'df48_' + h.toString(36); }
    function getCache() { try { return JSON.parse(GM_getValue(K.CACHE, '{}')); } catch (e) { return {}; } }
    function saveCache(c) { GM_setValue(K.CACHE, JSON.stringify(c)); }
    function getCached(q, t) { const c = getCache(); return c[hashKey(q, t)] || null; }
    function setCached(q, t, ans) {
        const c = getCache(); c[hashKey(q, t)] = { a: ans, tm: Date.now() };
        const e = Object.entries(c);
        if (e.length > 500) { e.sort((a, b) => (b[1].tm || 0) - (a[1].tm || 0)); const nc = {}; e.slice(0, 500).forEach(([k, v]) => { nc[k] = v; }); saveCache(nc); return; }
        saveCache(c);
    }

    // ==================== 页面适配（对分易） ====================
    let _subjects = null;
    function getSubjects() {
        if (_subjects) return _subjects;
        try { _subjects = JSON.parse(document.getElementById('hidS')?.value || '[]'); } catch (e) { _subjects = []; }
        return _subjects;
    }
    function getAnsweredSids() {
        const set = new Set();
        try {
            const ups = JSON.parse(document.getElementById('hidUps')?.value || '[]');
            ups.forEach(u => { if (u.SubjectID && u.Answer && String(u.Answer).trim()) set.add(String(u.SubjectID)); });
        } catch (e) { }
        return set;
    }
    function getPaperCtx() {
        return {
            userPaperID: document.getElementById('hidUserPaperID')?.value || '',
            histPaperID: document.getElementById('hidHistPaperID')?.value || ''
        };
    }

    function getCurrentQuestion() {
        const nameEl = document.getElementById('divSubjectName'), typeEl = document.getElementById('subjectType');
        if (!nameEl || !typeEl) return null;
        const qText = stripHtml(nameEl.innerHTML) || nameEl.textContent.trim();
        const typeText = (typeEl.textContent || '').trim();
        const curIdx = parseInt(document.getElementById('itemIndex')?.textContent) || 1;
        const total = parseInt(document.getElementById('allIndex')?.textContent) || 0;
        let typeId = 0;
        if (/判断/.test(typeText)) typeId = 1;
        else if (/单选/.test(typeText)) typeId = 2;
        else if (/多选/.test(typeText)) typeId = 3;
        else if (/填空/.test(typeText)) typeId = 4;
        else if (/问答|简答|主观/.test(typeText)) typeId = 5;
        return { qText, typeText, typeId, curIdx, total };
    }

    function getCurrentOptions() {
        const container = document.getElementById('divSubjectItem'); if (!container) return [];
        const opts = [];
        container.querySelectorAll('a[data-v]').forEach(a => {
            const label = a.getAttribute('data-v');
            const divs = a.querySelectorAll('div');
            const td = divs.length >= 2 ? divs[1] : (divs.length === 1 ? divs[0] : null);
            const text = td ? td.textContent.trim() : '';
            if (label) opts.push({ label, text, el: a });
        });
        return opts;
    }

    // SubjectID：DOM data-sid → hidS 题干匹配 → hidS 按题号索引
    function getCurrentSid(q) {
        const c = document.getElementById('divSubjectItem');
        if (c) { const el = c.querySelector('[data-sid]'); if (el) return el.getAttribute('data-sid'); }
        const list = getSubjects();
        if (list.length && q) {
            const t = clean(q.qText);
            const hit = list.find(s => {
                const sq = clean(stripHtml(String(s.Question || '')));
                return sq.length >= 6 && (t.startsWith(sq) || sq.startsWith(t.slice(0, Math.max(6, sq.length))));
            });
            if (hit) return String(hit.SubjectID);
            const e = list[(q.curIdx || 1) - 1];
            if (e && e.SubjectID) return String(e.SubjectID);
        }
        return null;
    }

    function isSelected(a) {
        return a.classList.contains('itemDone') || a.classList.contains('itemCur') ||
            a.classList.contains('on') || a.classList.contains('active') || a.getAttribute('aria-checked') === 'true';
    }
    async function selectOption(a) {
        if (!a) return false;
        if (isSelected(a)) return true;
        const tries = [
            () => { if (typeof $ !== 'undefined' && $.fn) $(a).triggerHandler('click'); },
            () => { if (typeof $ !== 'undefined' && $.fn) $(a).trigger('click'); },
            () => { a.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window })); },
            () => { a.click(); },
        ];
        for (const t of tries) {
            try { t(); } catch (e) { }
            await sleep(150);
            if (isSelected(a)) return true;
        }
        return false;
    }
    async function deselectOption(a) {
        if (!a || !isSelected(a)) return true;
        const tries = [
            () => { if (typeof $ !== 'undefined' && $.fn) $(a).triggerHandler('click'); },
            () => { if (typeof $ !== 'undefined' && $.fn) $(a).trigger('click'); },
            () => { a.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window })); },
        ];
        for (const t of tries) {
            try { t(); } catch (e) { }
            await sleep(150);
            if (!isSelected(a)) return true;
        }
        return false;
    }
    async function applyChoice(matched, isMulti) {
        const container = document.getElementById('divSubjectItem');
        if (!container) return { ok: false, failed: matched };
        const anchors = [...container.querySelectorAll('a[data-v]')];
        const target = new Set(matched);
        const failed = [];
        for (const a of anchors) {
            const v = a.getAttribute('data-v');
            if (!target.has(v) && isSelected(a)) {
                const ok = await deselectOption(a);
                if (!ok) log('warn', `选项 ${v} 取消选中失败`);
                else await sleep(200);
            }
        }
        for (const label of matched) {
            const a = anchors.find(x => x.getAttribute('data-v') === label);
            if (!a) { failed.push(label); continue; }
            const ok = await selectOption(a);
            if (!ok) { failed.push(label); log('warn', `选项 ${label} 点击后未进入选中态`); }
            if (isMulti) await sleep(400);
        }
        return { ok: failed.length === 0, failed };
    }

    // ---------- 问答题 ----------
    const toHtml = answer => answer.split(/\n+/).map(s => s.trim()).filter(Boolean).map(s => `<p>${esc(s)}</p>`).join('') || `<p>${esc(answer)}</p>`;

    async function fillEssay(answer) {
        const html = toHtml(answer);
        // UE.instants 里可能有切题后残留的失效实例，逐个尝试直到写入成功
        let ueOk = false;
        for (let t = 0; t < 25 && !ueOk; t++) {
            if (typeof UE !== 'undefined' && UE.instants) {
                for (const k in UE.instants) {
                    const u = UE.instants[k];
                    if (!u || !u.ready || !u.body || !u.body.isConnected) continue;
                    try { u.setContent(html); u.sync(); u.fireEvent('contentChange'); ueOk = true; break; }
                    catch (e) { /* 失效实例，尝试下一个 */ }
                }
            }
            if (!ueOk) await sleep(200);
        }
        if (!ueOk) log('warn', 'UEditor 写入失败（无可用实例），答案已通过接口直接保存到服务器');
        const ta = document.getElementById('ueditor_textarea_editorValue');
        if (ta) {
            const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
            setter.call(ta, html);
            ta.dispatchEvent(new Event('input', { bubbles: true }));
            ta.dispatchEvent(new Event('change', { bubbles: true }));
        }
        return ueOk;
    }

    // 真实保存接口（2026-10 实地抓包确认）：Action=redit_essay_question，成功响应 {"msg":"1","msgbox":"保存成功！"}
    function saveEssayRequest(sid, answer, sort) {
        const { userPaperID, histPaperID } = getPaperCtx();
        if (!userPaperID || !histPaperID || !sid) {
            log('err', `保存缺少参数: UserPaperID=${userPaperID || '无'} HistPaperID=${histPaperID || '无'} SubjectID=${sid || '无'}`);
            return Promise.resolve(false);
        }
        const body = `Action=redit_essay_question&UserPaperID=${encodeURIComponent(userPaperID)}&HistPaperID=${encodeURIComponent(histPaperID)}&SubjectID=${encodeURIComponent(sid)}&Answer=${encodeURIComponent(toHtml(answer))}&Sort=${sort || 1}&Score=0`;
        return new Promise(resolve => {
            GM_xmlhttpRequest({
                method: 'POST', url: location.origin + '/_Paper/StudentPaper.ashx',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
                data: body, timeout: 15000,
                onload: resp => {
                    try {
                        const b = JSON.parse(resp.responseText);
                        if (b.msg === '1') { resolve(true); return; }
                        log('err', `保存被拒绝: ${b.msgbox || String(resp.responseText).substring(0, 80)}`);
                    } catch (e) { log('err', `保存响应异常: HTTP ${resp.status} ${String(resp.responseText).substring(0, 60)}`); }
                    resolve(false);
                },
                onerror: () => { log('err', '保存请求网络错误'); resolve(false); },
                ontimeout: () => { log('err', '保存请求超时'); resolve(false); },
            });
        });
    }

    // ---------- 填空题 ----------
    async function fillBlank(aiAnswer) {
        const fb = document.querySelector('.subject-fillblank');
        if (!fb) { log('warn', '未找到 .subject-fillblank 填空容器'); return false; }
        const inputs = fb.querySelectorAll('input[type="text"], input:not([type])');
        if (!inputs.length) { log('warn', '填空容器内未找到输入框'); return false; }
        const answers = aiAnswer.split(/[;；\n]/).map(s => s.replace(/^\d+[.、．)\s]*/, '').trim()).filter(Boolean);
        let allOk = true, filled = false;
        for (let i = 0; i < inputs.length; i++) {
            const inp = inputs[i];
            const ans = answers[i] || answers[answers.length - 1] || '';
            if (!ans) continue;
            inp.focus();
            const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
            setter.call(inp, ans);
            await sleep(200);
            try { if (typeof inp.onchange === 'function') inp.onchange(); } catch (e) { }
            try { if (typeof FillAnswer === 'function') FillAnswer(inp); } catch (e) { }
            try { if (typeof $ !== 'undefined') { $(inp).triggerHandler('change'); $(inp).triggerHandler('keyup'); } } catch (e) { }
            inp.dispatchEvent(new Event('input', { bubbles: true }));
            inp.dispatchEvent(new Event('change', { bubbles: true }));
            inp.dispatchEvent(new Event('keyup', { bubbles: true }));
            if (inp.value !== ans) { log('warn', `填空[${i + 1}] 值校验失败，可能被页面脚本改写`); allOk = false; }
            else { inp.style.border = '2px solid #52c41a'; inp.style.backgroundColor = '#e6fffb'; filled = true; }
            await sleep(400);
        }
        return filled && allOk;
    }

    // ---------- 导航 ----------
    async function waitForIndex(n, timeout = 3000) {
        const start = Date.now();
        while (Date.now() - start < timeout) {
            await sleep(200);
            const idx = parseInt(document.getElementById('itemIndex')?.textContent);
            if (idx === n) return true;
        }
        return false;
    }
    async function jumpToQuestion(n) {
        const curIdx = parseInt(document.getElementById('itemIndex')?.textContent) || 0;
        if (curIdx === n) return true;
        try { if (typeof To_Sub === 'function') { To_Sub(n); if (await waitForIndex(n)) return true; } } catch (e) { }
        const cell = document.querySelectorAll('#answerSheet .viewTab>div')[n - 1];
        if (cell) {
            cell.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
            if (await waitForIndex(n)) return true;
        }
        return false;
    }
    async function waitForQuestionChange(prevIdx, prevText, timeout = 8000) {
        const start = Date.now();
        while (Date.now() - start < timeout) {
            if (S.stop || !S.running) return null;
            if (!S.paused) {
                const q = getCurrentQuestion();
                if (q && (q.curIdx !== prevIdx || q.qText !== prevText)) return q;
            }
            await sleep(200);
        }
        return null;
    }
    function goBackToList() {
        const opts = {};
        const map = { courseid: 'Header_CourseID', classtype: 'Header_ClassType', classid: 'sysClassID', ebatchid: 'hidEBatchID', moduleid: 'Header_ModuleID', histpaperid: 'hidHistPaperID' };
        for (const [k, id] of Object.entries(map)) { const v = document.getElementById(id)?.value; if (v) opts[k] = v; }
        try {
            if (typeof FromGoTo === 'function') FromGoTo('/_Paper/PC/PaperListSA.aspx', opts);
            else window.location.href = `https://www.duifene.com/_Paper/PC/PaperListSA.aspx?${new URLSearchParams(opts)}`;
        } catch (e) { window.location.href = 'https://www.duifene.com/_Paper/PC/PaperListSA.aspx'; }
    }

    // ==================== DeepSeek API ====================
    function buildPrompt(qText, options, typeId) {
        if (typeId === 5) return `【问答题】\n题目：${qText}\n\n请直接返回完整的答案内容，简洁准确。只返回答案，不解释。`;
        const os = options.map(o => `${o.label}. ${o.text}`).join('\n');
        if (typeId === 1) return `【判断题】\n题目：${qText}\n\n选项：\n${os}\n\n请判断对错，只返回"对"或"错"。`;
        if (typeId === 3) return `【多选题】请仔细阅读题目和每一个选项，选出所有正确的选项（可能不止一个）。\n\n题目：${qText}\n\n全部选项如下：\n${os}\n\n请只返回正确选项的字母，多个字母用逗号分隔（如：A,C,D）。只返回字母。`;
        return `【单选题】请仔细阅读题目，从以下选项中选出唯一正确的答案。\n\n题目：${qText}\n\n选项：\n${os}\n\n请只返回一个正确选项的字母（如：A）。只返回字母。`;
    }
    function callApiOnce(qText, options, typeId) {
        const apiKey = getCfg(K.KEY), model = getCfg(K.MODEL);
        if (!apiKey) return Promise.reject(new Error('请先在"设置"里填写 API Key'));
        return new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method: 'POST', url: 'https://api.deepseek.com/v1/chat/completions',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
                data: JSON.stringify({
                    model, messages: [
                        { role: 'system', content: '你是专业答题助手。请仔细分析题目和选项，给出准确答案。严格按要求输出。' },
                        { role: 'user', content: buildPrompt(qText, options, typeId) },
                    ], temperature: 0.05, max_tokens: typeId === 5 ? 2000 : 600
                }),
                timeout: 30000,
                onload: resp => {
                    try {
                        const b = JSON.parse(resp.responseText);
                        if (b.error) {
                            let msg = b.error.message || 'API错误';
                            if (resp.status === 404 || /model/i.test(b.error.code || '') || /model/i.test(msg)) msg = `模型"${model}"不存在或不可用，请在设置里改成 deepseek-chat`;
                            else if (resp.status === 401) msg = 'API Key 无效，请检查';
                            else if (resp.status === 402) msg = '账户余额不足，请充值';
                            reject(new Error(msg)); return;
                        }
                        S.apiCalls++;
                        if (b.usage) S.tokens += b.usage.total_tokens || 0;
                        updateStats();
                        resolve(b.choices[0].message.content.trim());
                    } catch (e) { reject(new Error('API 响应解析失败')); }
                },
                onerror: () => reject(new Error('网络错误')),
                ontimeout: () => reject(new Error('API 请求超时')),
            });
        });
    }
    async function callApi(qText, options, typeId) {
        try { return await callApiOnce(qText, options, typeId); }
        catch (e) {
            if (/Key|余额|模型/.test(e.message)) throw e;
            log('warn', `AI 调用失败（${e.message}），2 秒后重试...`);
            await sleep(2000);
            return await callApiOnce(qText, options, typeId);
        }
    }

    // ==================== 答案匹配 ====================
    const TRUE_WORDS = ['对', '正确', '是', '√', 't', 'true', 'yes', 'right', 'y'];
    const FALSE_WORDS = ['错', '错误', '否', '×', 'x', 'f', 'false', 'no', 'wrong', 'n'];
    function matchAnswer(aiAnswer, options, typeId) {
        const cleaned = aiAnswer.trim();
        if (typeId === 4 || typeId === 5) return [];
        const valid = new Set(options.map(o => o.label));
        if (typeId === 1) {
            const c = clean(cleaned);
            const sayTrue = TRUE_WORDS.some(w => c === clean(w)) || /^(对|正确|true|√)/.test(c);
            const sayFalse = !sayTrue && (FALSE_WORDS.some(w => c === clean(w)) || /^(错|错误|false|×)/.test(c));
            if (!sayTrue && !sayFalse) {
                for (const opt of options) { if (clean(cleaned) === clean(opt.text)) return [opt.label]; }
                return [];
            }
            const targetSet = sayTrue ? TRUE_WORDS : FALSE_WORDS;
            const opt = options.find(o => targetSet.some(w => clean(o.text) === clean(w)));
            if (opt) return [opt.label];
            const opt2 = options.find(o => targetSet.some(w => w.length > 1 && clean(o.text).includes(clean(w))));
            return opt2 ? [opt2.label] : [];
        }
        const letterOnly = cleaned.match(/^[A-Ha-h](\s*[,，、]\s*[A-Ha-h])*$/) || cleaned.match(/^[A-Ha-h]{2,8}$/);
        if (letterOnly) {
            const m = [...new Set(cleaned.replace(/[,，、\s]/g, '').toUpperCase().split(''))].filter(l => valid.has(l));
            if (m.length) return typeId === 2 ? [m[0]] : m;
        }
        const pref = cleaned.match(/(?:答案|选项|选择)\s*[:：是为]?\s*([A-Ha-h](\s*[,，、]?\s*[A-Ha-h])*)/);
        if (pref) {
            const m = [...new Set(pref[1].replace(/[,，、\s]/g, '').toUpperCase().split(''))].filter(l => valid.has(l));
            if (m.length) return typeId === 2 ? [m[0]] : m;
        }
        const pickM = cleaned.match(/选\s*[:：]?\s*([A-Ha-h](\s*[,，、]?\s*[A-Ha-h])*)/);
        if (pickM) {
            const m = [...new Set(pickM[1].replace(/[,，、\s]/g, '').toUpperCase().split(''))].filter(l => valid.has(l));
            if (m.length) return typeId === 2 ? [m[0]] : m;
        }
        for (const opt of options) { if (clean(cleaned) === clean(opt.text)) return [opt.label]; }
        for (const opt of options) {
            const co = clean(opt.text);
            if (co.length >= 2 && (clean(cleaned).includes(co) || co.includes(clean(cleaned)))) {
                if (typeId === 2) return [opt.label];
            }
        }
        return [];
    }

    // ==================== 运行状态 ====================
    const S = {
        running: false, paused: false, stop: false,
        ok: 0, fail: 0, skip: 0, apiCalls: 0, tokens: 0, consecFail: 0,
        answered: new Set(), failed: new Set(), serverDone: new Set(),
        total: 0, cur: 0
    };
    const TAB_ID = Math.random().toString(36).slice(2);
    let lockTimer = null;
    function acquireLock() {
        try {
            const l = JSON.parse(GM_getValue(K.LOCK, '{}'));
            if (l.id && l.id !== TAB_ID && Date.now() - l.ts < 10000) return false;
        } catch (e) { }
        GM_setValue(K.LOCK, JSON.stringify({ id: TAB_ID, ts: Date.now() }));
        lockTimer = setInterval(() => { if (S.running) GM_setValue(K.LOCK, JSON.stringify({ id: TAB_ID, ts: Date.now() })); }, 3000);
        return true;
    }
    function releaseLock() {
        if (lockTimer) clearInterval(lockTimer);
        try { const l = JSON.parse(GM_getValue(K.LOCK, '{}')); if (l.id === TAB_ID) GM_setValue(K.LOCK, '{}'); } catch (e) { }
    }

    // ==================== UI（Shadow DOM） ====================
    let shadow = null, agreed = false;
    const qs = s => shadow && shadow.querySelector(s);

    const CSS = `
*{box-sizing:border-box;margin:0;padding:0}
.ball{position:fixed;right:24px;bottom:24px;width:48px;height:48px;border-radius:50%;background:linear-gradient(135deg,#4f46e5,#7c3aed);color:#fff;font-size:20px;font-weight:700;display:flex;align-items:center;justify-content:center;cursor:pointer;box-shadow:0 4px 16px rgba(79,70,229,.4);z-index:2147483645;user-select:none;font-family:-apple-system,'Segoe UI','Microsoft YaHei',sans-serif}
.panel{position:fixed;right:24px;bottom:84px;width:380px;max-height:74vh;background:#fff;border-radius:14px;box-shadow:0 10px 40px rgba(0,0,0,.18);z-index:2147483646;display:flex;flex-direction:column;overflow:hidden;font-family:-apple-system,'Segoe UI','Microsoft YaHei',sans-serif;font-size:13px;color:#1f2937}
.panel.hidden{display:none}
.hd{background:linear-gradient(135deg,#4f46e5,#7c3aed);color:#fff;padding:10px 14px;display:flex;justify-content:space-between;align-items:center;cursor:move;user-select:none;font-weight:600}
.hd i{font-style:normal;font-size:11px;opacity:.75;margin-left:6px;font-weight:400}
.hd b{cursor:pointer;font-size:16px;padding:0 4px;font-weight:400}
.tabs{display:flex;background:#f3f4f6;padding:6px 8px;gap:6px}
.tabs button{flex:1;border:none;background:transparent;padding:6px 0;border-radius:8px;font-size:12px;cursor:pointer;color:#6b7280;font-family:inherit}
.tabs button.on{background:#fff;color:#4f46e5;font-weight:600;box-shadow:0 1px 4px rgba(0,0,0,.08)}
.body{padding:12px 14px;overflow-y:auto;flex:1}
section{display:none}section.on{display:block}
.status{display:flex;justify-content:space-between;align-items:center;margin-bottom:6px}
.badge{font-size:11px;padding:2px 10px;border-radius:10px;background:#eef2ff;color:#4f46e5}
.badge.warn{background:#fef3c7;color:#d97706}
.prog{height:6px;background:#f3f4f6;border-radius:3px;overflow:hidden;margin:8px 0}
.prog>div{height:100%;background:linear-gradient(90deg,#4f46e5,#7c3aed);width:0;transition:width .3s}
.stats{display:flex;gap:12px;font-size:12px;color:#6b7280;margin-bottom:6px;flex-wrap:wrap}
.stats b{font-weight:600}
.sheet{display:flex;flex-wrap:wrap;gap:6px;margin:8px 0;max-height:150px;overflow-y:auto}
.cell{width:30px;height:30px;border-radius:6px;background:#f3f4f6;color:#6b7280;display:flex;align-items:center;justify-content:center;font-size:12px;cursor:pointer;transition:transform .1s}
.cell:hover{transform:scale(1.12)}
.cell.done{background:#d1fae5;color:#059669}
.cell.fail{background:#fee2e2;color:#dc2626}
.cell.cur{box-shadow:0 0 0 2px #f59e0b;color:#d97706;font-weight:700}
.btn{display:block;width:100%;padding:9px 12px;margin:5px 0;border:none;border-radius:8px;font-size:13px;cursor:pointer;font-weight:500;font-family:inherit;text-align:center}
.btn-go{background:linear-gradient(135deg,#4f46e5,#7c3aed);color:#fff}
.btn-pause{background:#f59e0b;color:#fff}
.btn-stop{background:#ef4444;color:#fff}
.btn-sub{background:#10b981;color:#fff}
.btn-line{background:#fff;border:1px solid #e5e7eb;color:#374151}
.btn:disabled{opacity:.45;cursor:not-allowed}
label{display:block;font-size:11px;color:#9ca3af;margin:10px 0 4px}
input[type=text],input[type=password],input[type=number]{width:100%;padding:7px 9px;border:1px solid #e5e7eb;border-radius:7px;font-size:12px;font-family:inherit}
input:focus{border-color:#4f46e5;outline:none}
.chk{display:flex;align-items:center;gap:6px;margin-top:10px;font-size:12px;color:#4b5563}
.chk input{width:auto}
.row{display:flex;gap:8px}
.row .btn{margin:5px 0}
.hint{font-size:11px;color:#9ca3af;margin-top:6px;line-height:1.5}
.logbox{background:#f9fafb;border:1px solid #f3f4f6;border-radius:8px;height:320px;overflow-y:auto;padding:6px 8px;font-family:Consolas,'Courier New',monospace;font-size:11px}
.logbox div{padding:1px 0;word-break:break-all;white-space:pre-wrap}
.lv-info{color:#6b7280}.lv-ok{color:#059669}.lv-err{color:#dc2626}.lv-warn{color:#d97706}.lv-ai{color:#7c3aed}.lv-q{color:#2563eb}.lv-sys{color:#9333ea}
.toast{position:fixed;top:20px;left:50%;transform:translateX(-50%);background:rgba(17,24,39,.92);color:#fff;padding:10px 22px;border-radius:10px;font-size:13px;z-index:2147483647;box-shadow:0 4px 16px rgba(0,0,0,.25);font-family:-apple-system,'Segoe UI','Microsoft YaHei',sans-serif;transition:opacity .3s}
.overlay{position:fixed;inset:0;background:rgba(17,24,39,.5);z-index:2147483647;display:flex;align-items:center;justify-content:center}
.dlg{background:#fff;border-radius:14px;width:460px;max-width:92vw;padding:22px;box-shadow:0 20px 60px rgba(0,0,0,.3);font-family:-apple-system,'Segoe UI','Microsoft YaHei',sans-serif}
.dlg h3{font-size:16px;margin-bottom:10px;color:#111827}
.dlg p{font-size:12px;color:#4b5563;line-height:1.8;max-height:220px;overflow-y:auto;background:#f9fafb;padding:12px;border-radius:8px}
.dlg .row{margin-top:14px}
.about p{font-size:12px;color:#4b5563;line-height:1.8;margin-bottom:8px}
`;

    function buildUI() {
        const host = document.createElement('div');
        host.id = 'dfx-host';
        shadow = host.attachShadow({ mode: 'open' });
        shadow.innerHTML = `
<style>${CSS}</style>
<div class="ball" id="ball" title="对分易答题助手">答</div>
<div class="panel hidden" id="panel">
  <div class="hd" id="hd"><span>🤖 对分易答题助手<i>v${VERSION}</i></span><b id="minBtn">−</b></div>
  <div class="tabs">
    <button data-t="run" class="on">运行</button><button data-t="log">日志</button><button data-t="set">设置</button><button data-t="about">关于</button>
  </div>
  <div class="body">
    <section id="tab-run" class="on">
      <div class="status"><span id="r-status">就绪</span><span class="badge" id="r-type">未开始</span></div>
      <div class="prog"><div id="r-prog"></div></div>
      <div class="stats">
        <span>✅ <b id="r-ok" style="color:#059669">0</b></span>
        <span>❌ <b id="r-fail" style="color:#dc2626">0</b></span>
        <span>⏭️ <b id="r-skip" style="color:#6b7280">0</b></span>
        <span>🤖 <b id="r-api">0</b> 次</span>
        <span>🔤 <b id="r-tok">0</b></span>
      </div>
      <div class="sheet" id="r-sheet"></div>
      <button class="btn btn-go" id="r-go">🚀 开始自动答题</button>
      <div class="row">
        <button class="btn btn-pause" id="r-pause" disabled>⏸️ 暂停</button>
        <button class="btn btn-stop" id="r-stop" disabled>⏹️ 停止</button>
      </div>
      <div class="row">
        <button class="btn btn-sub" id="r-submit">📤 提交试卷</button>
        <button class="btn btn-line" id="r-back">↩️ 返回列表</button>
      </div>
      <div class="hint">快捷键：Alt+Q 开始/暂停 · Alt+W 停止（可在设置关闭）</div>
    </section>
    <section id="tab-log">
      <div class="logbox" id="l-box"></div>
      <div class="row">
        <button class="btn btn-line" id="l-clear">🗑️ 清空日志</button>
        <button class="btn btn-line" id="l-export">📥 导出日志</button>
      </div>
    </section>
    <section id="tab-set">
      <label>🔑 DeepSeek API Key</label>
      <input type="password" id="s-key" placeholder="sk-...">
      <label>📦 模型</label>
      <input type="text" id="s-model" placeholder="deepseek-chat">
      <label>⏱️ 题间延时（毫秒）</label>
      <input type="number" id="s-delay" min="300" max="10000">
      <div class="chk"><input type="checkbox" id="s-skip"><span>跳过已作答的题目</span></div>
      <div class="chk"><input type="checkbox" id="s-asub"><span>答完后自动提交（提交前会弹窗确认）</span></div>
      <div class="chk"><input type="checkbox" id="s-aret"><span>提交后返回练习列表</span></div>
      <div class="chk"><input type="checkbox" id="s-sc"><span>启用快捷键</span></div>
      <label>💾 答案缓存（<span id="s-cachenum">0</span> 条，上限 500）</label>
      <div class="row">
        <button class="btn btn-line" id="s-clear">清空缓存</button>
        <button class="btn btn-line" id="s-test">测试 API</button>
      </div>
      <label>⚙️ 配置</label>
      <div class="row">
        <button class="btn btn-line" id="s-export">导出配置</button>
        <button class="btn btn-line" id="s-import">导入配置</button>
        <button class="btn btn-line" id="s-reset">恢复默认</button>
      </div>
      <input type="file" id="s-file" accept=".json" style="display:none">
      <div class="hint">API Key 仅存储在你本机的 Tampermonkey 存储中，不会发送给 DeepSeek 以外的任何方。</div>
    </section>
    <section id="tab-about">
      <div class="about">
        <p><b>对分易自动答题助手 v${VERSION}</b></p>
        <p>支持题型：单选 / 多选 / 判断 / 填空 / 问答。问答题通过真实保存接口写入服务器并验证结果。</p>
        <p>答题卡图例：绿=已完成 · 红=失败 · 黄框=当前题。点击格子可跳题（未运行时）。</p>
        <p style="color:#9ca3af">${DISCLAIMER}</p>
      </div>
    </section>
  </div>
</div>`;
        document.body.appendChild(host);
        bindUI();
        loadSettings();
    }

    function bindUI() {
        const ball = qs('#ball'), panel = qs('#panel');
        // 悬浮球：拖拽 or 点击
        let bx, by, moved;
        ball.addEventListener('mousedown', e => {
            e.preventDefault(); moved = false; bx = e.clientX; by = e.clientY;
            const r = ball.getBoundingClientRect(); const ox = r.left, oy = r.top;
            const mm = e2 => {
                const dx = e2.clientX - bx, dy = e2.clientY - by;
                if (Math.abs(dx) + Math.abs(dy) > 5) moved = true;
                if (moved) {
                    ball.style.left = (ox + dx) + 'px'; ball.style.top = (oy + dy) + 'px';
                    ball.style.right = 'auto'; ball.style.bottom = 'auto';
                }
            };
            const mu = () => {
                document.removeEventListener('mousemove', mm); document.removeEventListener('mouseup', mu);
                if (!moved) { panel.classList.toggle('hidden'); if (!panel.classList.contains('hidden')) loadSettings(); }
                else setCfg(K.POS, { x: parseInt(ball.style.left), y: parseInt(ball.style.top) });
            };
            document.addEventListener('mousemove', mm); document.addEventListener('mouseup', mu);
        });
        // 恢复悬浮球位置
        try {
            const pos = GM_getValue(K.POS);
            if (pos && pos.x !== undefined) {
                ball.style.left = pos.x + 'px'; ball.style.top = pos.y + 'px';
                ball.style.right = 'auto'; ball.style.bottom = 'auto';
            }
        } catch (e) { }
        // 面板头部拖拽
        const hd = qs('#hd');
        hd.addEventListener('mousedown', e => {
            if (e.target.id === 'minBtn') return;
            e.preventDefault();
            const r = panel.getBoundingClientRect(); const ox = r.left - e.clientX, oy = r.top - e.clientY;
            const mm = e2 => {
                panel.style.left = Math.max(0, e2.clientX + ox) + 'px'; panel.style.top = Math.max(0, e2.clientY + oy) + 'px';
                panel.style.right = 'auto'; panel.style.bottom = 'auto';
            };
            const mu = () => { document.removeEventListener('mousemove', mm); document.removeEventListener('mouseup', mu); };
            document.addEventListener('mousemove', mm); document.addEventListener('mouseup', mu);
        });
        qs('#minBtn').addEventListener('click', () => panel.classList.add('hidden'));
        // Tab 切换
        shadow.querySelectorAll('.tabs button').forEach(b => {
            b.addEventListener('click', () => {
                shadow.querySelectorAll('.tabs button').forEach(x => x.classList.toggle('on', x === b));
                shadow.querySelectorAll('section').forEach(s => s.classList.toggle('on', s.id === 'tab-' + b.dataset.t));
            });
        });
        // 运行按钮
        qs('#r-go').addEventListener('click', () => startAnswer());
        qs('#r-pause').addEventListener('click', () => pauseResume());
        qs('#r-stop').addEventListener('click', () => stopAnswer());
        qs('#r-submit').addEventListener('click', () => {
            if (confirm('确定提交试卷吗？')) {
                try { if (typeof SubmitPaper === 'function') { SubmitPaper(); toast('📤 已提交'); } else toast('未找到提交函数'); }
                catch (e) { toast('提交失败: ' + e.message); }
            }
        });
        qs('#r-back').addEventListener('click', () => { goBackToList(); toast('↩️ 返回列表'); });
        // 日志
        qs('#l-clear').addEventListener('click', () => { qs('#l-box').innerHTML = ''; logLines.length = 0; });
        qs('#l-export').addEventListener('click', exportLog);
        // 设置
        ['s-key', 's-model', 's-delay'].forEach(id => { qs('#' + id).addEventListener('change', saveSettings); qs('#' + id).addEventListener('blur', saveSettings); });
        ['s-skip', 's-asub', 's-aret', 's-sc'].forEach(id => qs('#' + id).addEventListener('change', saveSettings));
        qs('#s-clear').addEventListener('click', () => {
            if (confirm('确定清空所有答案缓存？')) { saveCache({}); qs('#s-cachenum').textContent = '0'; toast('✅ 缓存已清空'); }
        });
        qs('#s-test').addEventListener('click', testApi);
        qs('#s-export').addEventListener('click', exportConfig);
        qs('#s-import').addEventListener('click', () => qs('#s-file').click());
        qs('#s-file').addEventListener('change', importConfig);
        qs('#s-reset').addEventListener('click', () => {
            if (confirm('恢复默认配置？（API Key 也会被清除）')) {
                [K.KEY, K.MODEL, K.DELAY, K.AUTO_SUBMIT, K.AUTO_RETURN, K.SKIP_DONE, K.SHORTCUT].forEach(k => GM_setValue(k, undefined));
                loadSettings(); toast('✅ 已恢复默认');
            }
        });
    }

    function loadSettings() {
        if (!shadow) return;
        qs('#s-key').value = getCfg(K.KEY) || '';
        qs('#s-model').value = getCfg(K.MODEL) || D.MODEL;
        qs('#s-delay').value = getCfg(K.DELAY);
        qs('#s-skip').checked = getCfg(K.SKIP_DONE);
        qs('#s-asub').checked = getCfg(K.AUTO_SUBMIT);
        qs('#s-aret').checked = getCfg(K.AUTO_RETURN);
        qs('#s-sc').checked = getCfg(K.SHORTCUT);
        qs('#s-cachenum').textContent = Object.keys(getCache()).length;
    }
    function saveSettings() {
        if (!shadow) return;
        setCfg(K.KEY, qs('#s-key').value.trim());
        setCfg(K.MODEL, qs('#s-model').value.trim() || D.MODEL);
        setCfg(K.DELAY, Math.min(10000, Math.max(300, parseInt(qs('#s-delay').value) || D.DELAY)));
        setCfg(K.SKIP_DONE, qs('#s-skip').checked);
        setCfg(K.AUTO_SUBMIT, qs('#s-asub').checked);
        setCfg(K.AUTO_RETURN, qs('#s-aret').checked);
        setCfg(K.SHORTCUT, qs('#s-sc').checked);
    }

    // ---------- 日志 / 提示 ----------
    const logLines = [];
    function log(level, msg) {
        const box = qs('#l-box');
        const time = new Date().toLocaleTimeString('zh-CN', { hour12: false });
        const line = `[${time}] ${msg}`;
        logLines.push(line);
        if (logLines.length > 500) logLines.shift();
        if (!box) { console.log('[对分易]', line); return; }
        const div = document.createElement('div');
        div.className = 'lv-' + (level === 'fail' ? 'err' : level);
        div.textContent = line;
        box.appendChild(div);
        while (box.children.length > 500) box.firstChild.remove();
        box.scrollTop = box.scrollHeight;
    }
    function toast(msg, dur = 2500) {
        if (!shadow) return;
        const el = document.createElement('div');
        el.className = 'toast'; el.textContent = msg;
        shadow.appendChild(el);
        setTimeout(() => { el.style.opacity = '0'; setTimeout(() => el.remove(), 300); }, dur);
    }

    function updateStats() {
        if (!shadow) return;
        qs('#r-ok').textContent = S.ok;
        qs('#r-fail').textContent = S.fail;
        qs('#r-skip').textContent = S.skip;
        qs('#r-api').textContent = S.apiCalls;
        qs('#r-tok').textContent = S.tokens;
        const done = S.ok + S.fail + S.skip;
        qs('#r-prog').style.width = S.total ? Math.round(done / S.total * 100) + '%' : '0';
    }
    function setStatus(text, badge, warn) {
        if (!shadow) return;
        qs('#r-status').textContent = text;
        const b = qs('#r-type'); b.textContent = badge; b.className = 'badge' + (warn ? ' warn' : '');
    }
    function renderSheet(cur) {
        const sheet = qs('#r-sheet'); if (!sheet) return;
        sheet.innerHTML = '';
        for (let i = 1; i <= S.total; i++) {
            const c = document.createElement('div');
            c.className = 'cell';
            if (S.answered.has(i)) c.classList.add('done');
            if (S.failed.has(i)) c.classList.add('fail');
            if (i === cur) c.classList.add('cur');
            c.textContent = i;
            c.title = `第 ${i} 题`;
            c.addEventListener('click', async () => {
                if (S.running) { toast('答题运行中，暂不能跳题'); return; }
                if (await jumpToQuestion(i)) { S.cur = i; renderSheet(i); }
                else toast(`跳转第 ${i} 题失败`);
            });
            sheet.appendChild(c);
        }
    }
    function updateBtns() {
        if (!shadow) return;
        qs('#r-go').disabled = S.running;
        qs('#r-pause').disabled = !S.running;
        qs('#r-stop').disabled = !S.running;
        qs('#r-pause').textContent = S.paused ? '▶️ 继续' : '⏸️ 暂停';
    }

    // ---------- 设置辅助 ----------
    async function testApi() {
        saveSettings();
        if (!getCfg(K.KEY)) { toast('请先填写 API Key'); return; }
        toast('⏳ 测试 API 中...');
        try {
            const r = await callApi('1+1等于几？只返回数字。', [], 2);
            toast(`✅ API 正常，返回: ${r.substring(0, 30)}`, 3500);
            log('ok', `API 测试成功，返回: ${r.substring(0, 50)}`);
        } catch (e) {
            toast('❌ ' + e.message, 4000);
            log('err', 'API 测试失败: ' + e.message);
        }
    }
    function exportConfig() {
        saveSettings();
        const cfg = {};
        [K.KEY, K.MODEL, K.DELAY, K.AUTO_SUBMIT, K.AUTO_RETURN, K.SKIP_DONE, K.SHORTCUT].forEach(k => cfg[k] = getCfg(k));
        download('duifene-config.json', JSON.stringify(cfg, null, 2));
        toast('📥 配置已导出');
    }
    function importConfig() {
        const f = qs('#s-file').files[0]; if (!f) return;
        const rd = new FileReader();
        rd.onload = () => {
            try {
                const cfg = JSON.parse(rd.result);
                let n = 0;
                [K.KEY, K.MODEL, K.DELAY, K.AUTO_SUBMIT, K.AUTO_RETURN, K.SKIP_DONE, K.SHORTCUT].forEach(k => {
                    if (cfg[k] !== undefined) { setCfg(k, cfg[k]); n++; }
                });
                loadSettings(); toast(`✅ 已导入 ${n} 项配置`);
            } catch (e) { toast('❌ 配置文件格式错误'); }
            qs('#s-file').value = '';
        };
        rd.readAsText(f);
    }
    function exportLog() {
        download('duifene-log-' + new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-') + '.txt', logLines.join('\n'));
        toast('📥 日志已导出');
    }
    function download(name, content) {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(new Blob([content], { type: 'text/plain;charset=utf-8' }));
        a.download = name;
        shadow.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    }

    // ---------- 免责声明 ----------
    function showDisclaimer() {
        if (!shadow) return;
        const ov = document.createElement('div');
        ov.className = 'overlay';
        ov.innerHTML = `<div class="dlg"><h3>⚠️ 免责声明</h3><p>${DISCLAIMER}</p>
<div class="row"><button class="btn btn-go" id="d-agree">我已阅读并同意</button><button class="btn btn-line" id="d-no">不同意</button></div></div>`;
        shadow.appendChild(ov);
        ov.querySelector('#d-agree').addEventListener('click', () => { agreed = true; ov.remove(); log('sys', '已同意免责声明'); });
        ov.querySelector('#d-no').addEventListener('click', () => {
            document.getElementById('dfx-host')?.remove();
            console.log('[对分易] 用户未同意免责声明，脚本 UI 已卸载。刷新页面可重新加载。');
        });
    }

    // ==================== 答题引擎 ====================
    async function startAnswer() {
        if (S.running) { toast('⏳ 正在答题中...'); return; }
        if (!agreed) { showDisclaimer(); return; }
        if (!getCfg(K.KEY)) { toast('请先在"设置"里填写 API Key', 3500); return; }
        const info = getCurrentQuestion();
        if (!info) { toast('⚠️ 未检测到答题页面，请先进入一份试卷'); return; }
        if (!acquireLock()) { toast('⚠️ 检测到另一个标签页正在答题，请勿同时运行', 4000); return; }

        saveSettings();
        Object.assign(S, { ok: 0, fail: 0, skip: 0, apiCalls: 0, tokens: 0, consecFail: 0, total: info.total, cur: info.curIdx });
        S.answered.clear(); S.failed.clear();
        S.serverDone = getCfg(K.SKIP_DONE) ? getAnsweredSids() : new Set();
        S.running = true; S.paused = false; S.stop = false;
        updateBtns(); updateStats(); renderSheet(info.curIdx);
        setStatus(`答题中 第 ${info.curIdx}/${info.total} 题`, '运行中');
        log('sys', `═══ 开始答题 v${VERSION} ═══`);
        log('info', `共 ${info.total} 题 | 题间延时 ${getCfg(K.DELAY)}ms | 模型 ${getCfg(K.MODEL)} | 跳过已答 ${getCfg(K.SKIP_DONE) ? '开' : '关'}`);
        if (S.serverDone.size) log('info', `检测到服务器已有 ${S.serverDone.size} 题作答记录`);

        const delay = getCfg(K.DELAY) || D.DELAY;
        let cur = info;
        for (let i = info.curIdx; i <= info.total; i++) {
            while (S.paused && S.running && !S.stop) await sleep(300);
            if (S.stop || !S.running) break;

            await sleep(400);
            const q = getCurrentQuestion();
            if (q) cur = q;
            S.cur = cur.curIdx;
            const sid = getCurrentSid(cur);
            setStatus(`答题中 第 ${cur.curIdx}/${cur.total} 题`, '运行中');
            renderSheet(cur.curIdx);
            log('q', `Q${cur.curIdx}/${cur.total} [${cur.typeText || '未知题型'}] ${cur.qText.substring(0, 50)}${cur.qText.length > 50 ? '…' : ''}`);

            // 已作答跳过
            if (sid && S.serverDone.has(sid)) {
                log('info', `服务器已有作答记录，跳过`);
                S.skip++; S.answered.add(cur.curIdx);
                updateStats(); renderSheet(cur.curIdx);
                cur = await goNext(i, cur, delay);
                if (!cur) break;
                continue;
            }

            let filled = false;
            try {
                const options = getCurrentOptions();
                let answer = null, source = '';
                const cached = getCached(cur.qText, cur.typeId);
                if (cached) { answer = cached.a; source = '💾缓存'; log('info', `命中缓存 → ${answer.substring(0, 80)}`); }
                if (!answer) {
                    log('ai', '调用 DeepSeek API...');
                    answer = await callApi(cur.qText, options, cur.typeId);
                    source = '🤖AI';
                    log('ai', `返回 → ${answer.substring(0, 120)}`);
                    if (answer) setCached(cur.qText, cur.typeId, answer);
                }

                if (S.stop || !S.running) break;

                if (cur.typeId === 5) {
                    if (!sid) {
                        log('err', '无法确定 SubjectID，本题无法保存');
                    } else {
                        await fillEssay(answer);
                        filled = await saveEssayRequest(sid, answer, cur.curIdx);
                        if (!filled) {
                            log('warn', '保存失败，1.5 秒后重试一次...');
                            await sleep(1500);
                            filled = await saveEssayRequest(sid, answer, cur.curIdx);
                        }
                        if (filled) log('ok', '问答题已保存到服务器 ✅');
                        else {
                            log('err', '问答题保存失败，已自动暂停。答案已写入编辑器，可手动检查保存，或点"继续"重试本题');
                            S.paused = true; updateBtns(); setStatus('已暂停（保存失败）', '需人工处理', true);
                            toast('❌ 问答题保存失败，已暂停', 4000);
                            i--; continue; // 不切题，恢复后重试当前题
                        }
                    }
                } else if (cur.typeId === 4) {
                    filled = await fillBlank(answer);
                    log(filled ? 'ok' : 'err', `填空${filled ? '成功' : '失败'}: ${answer.substring(0, 40)}`);
                } else if (cur.typeId >= 1 && cur.typeId <= 3) {
                    if (!options.length) {
                        log('err', '未读取到选项，跳过本题');
                    } else {
                        const matched = matchAnswer(answer, options, cur.typeId);
                        if (matched.length) {
                            const r = await applyChoice(matched, cur.typeId === 3);
                            filled = r.ok;
                            if (r.ok) log('ok', `已选 ${matched.join(',')} [${source}]（选中态已验证）`);
                            else log('err', `选项 ${r.failed.join(',')} 未能选中，请手动检查本题`);
                        } else {
                            log('err', `无法匹配答案 → "${answer.substring(0, 60)}"`);
                        }
                    }
                } else {
                    log('warn', `未支持的题型"${cur.typeText}"，跳过`);
                }
            } catch (err) {
                log('err', `出错: ${err.message}`);
            }

            if (filled) { S.ok++; S.consecFail = 0; S.answered.add(cur.curIdx); S.failed.delete(cur.curIdx); }
            else { S.fail++; S.consecFail++; S.failed.add(cur.curIdx); }
            updateStats(); renderSheet(cur.curIdx);

            if (S.consecFail >= 3) {
                log('err', '连续 3 题失败，已自动暂停。请检查 API Key / 余额 / 网络后点"继续"');
                toast('⚠️ 连续失败，已暂停', 3500);
                S.paused = true; updateBtns(); setStatus('已暂停（连续失败）', '需人工处理', true);
                i--; continue; // 不切题，恢复后重试当前题
            }

            cur = await goNext(i, cur, delay);
            if (!cur) break;
        }

        const stopped = S.stop;
        S.running = false; S.paused = false; S.stop = false;
        updateBtns(); releaseLock();
        if (stopped) {
            setStatus('已停止', '就绪');
            log('sys', `═══ 已手动停止 ═══ 完成 ✅${S.ok} ❌${S.fail} ⏭️${S.skip}`);
            return;
        }
        setStatus('已完成', '完成');
        log('sys', `═══ 答题结束 ═══ 完成 ✅${S.ok} ❌${S.fail} ⏭️${S.skip} / 共 ${S.total} 题 | API ${S.apiCalls} 次 | ${S.tokens} tokens`);
        toast(`✅ 完成！成功 ${S.ok}/${S.total}`, 3500);

        if (getCfg(K.AUTO_SUBMIT) && S.ok > 0) {
            if (confirm(`答题完成（成功 ${S.ok}/${S.total}），确定提交试卷吗？`)) {
                log('sys', '自动提交中...');
                await sleep(1500);
                try { if (typeof SubmitPaper === 'function') { SubmitPaper(); log('ok', '已提交'); } } catch (e) { log('err', '提交失败: ' + e.message); }
                if (getCfg(K.AUTO_RETURN)) { await sleep(2000); goBackToList(); }
            } else {
                log('info', '用户取消自动提交');
            }
        }
    }

    async function goNext(i, cur, delay) {
        if (i >= cur.total) return cur;
        if (S.stop || !S.running) return cur;
        log('info', `→ 第 ${i + 1} 题`);
        await sleep(delay);
        const prevIdx = cur.curIdx, prevText = cur.qText;
        try { if (typeof Sub_Next === 'function') Sub_Next(); } catch (e) { }
        let next = await waitForQuestionChange(prevIdx, prevText);
        if (!next) {
            log('warn', '等待切题超时，尝试 To_Sub 跳转');
            await jumpToQuestion(i + 1);
            next = await waitForQuestionChange(prevIdx, prevText, 4000);
            if (!next) {
                const retry = getCurrentQuestion();
                if (retry && retry.curIdx === prevIdx && retry.qText === prevText) {
                    log('err', '题目未切换，停止以避免重复作答');
                    S.stop = true;
                    return null;
                }
                next = retry;
            }
        }
        return next;
    }

    function pauseResume() {
        if (!S.running) { startAnswer(); return; }
        S.paused = !S.paused;
        updateBtns();
        setStatus(S.paused ? '已暂停' : `答题中 第 ${S.cur}/${S.total} 题`, S.paused ? '暂停' : '运行中', S.paused);
        log('sys', S.paused ? '⏸️ 已暂停' : '▶️ 继续答题');
        toast(S.paused ? '⏸️ 已暂停' : '▶️ 继续');
    }
    function stopAnswer() {
        if (!S.running) return;
        S.stop = true; S.paused = false;
        log('sys', '⏹️ 停止中（当前题目完成后退出）...');
        updateBtns();
    }

    // ==================== 快捷键 ====================
    document.addEventListener('keydown', e => {
        if (!getCfg(K.SHORTCUT)) return;
        if (/INPUT|TEXTAREA/.test(document.activeElement?.tagName || '') || document.activeElement?.isContentEditable) return;
        if (e.altKey && !e.ctrlKey && !e.shiftKey && e.code === 'KeyQ') { e.preventDefault(); pauseResume(); }
        if (e.altKey && !e.ctrlKey && !e.shiftKey && e.code === 'KeyW') { e.preventDefault(); stopAnswer(); }
    });

    // ==================== 初始化 ====================
    function init() {
        console.log(`[对分易] 🚀 v${VERSION}`);
        buildUI();
        showDisclaimer();
        log('sys', `v${VERSION} 已就绪 — Shadow DOM UI · 问答题真实保存接口 · 保存结果验证`);
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})();
