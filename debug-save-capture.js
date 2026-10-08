/**
 * 对分易 — 保存请求抓包脚本
 * 用途：捕获你手动答题时网页真实发出的保存请求（URL + 请求体 + 响应）
 * 用法：F12 → Console（控制台）→ 粘贴本文件全部内容 → 回车
 *       然后手动做一道填空题或问答题（打字 → 点别处或切下一题，触发保存）
 *       最后把控制台输出截图/复制发给我
 */
(function () {
    console.clear();
    const C = (t, m, c) => console.log(`%c${t}%c ${m}`, `color:${c};font-weight:bold`, 'color:#ccc');
    window.__captured = [];

    function record(method, url, body, status, resp) {
        if (!/POST|PUT|PATCH/i.test(method)) return; // 只看提交类请求
        if (/\.(js|css|png|jpg|jpeg|gif|svg|ico|woff)/i.test(url)) return; // 过滤静态资源
        const item = {
            时间: new Date().toLocaleTimeString(),
            方法: method,
            URL: url,
            请求体: String(body ?? '').substring(0, 800),
            状态: status,
            响应: String(resp ?? '').substring(0, 300),
        };
        window.__captured.push(item);
        const hot = /save|answer|subject|paper|submit|ashx|update/i.test(url);
        console.log(`%c${hot ? '🔥[重点]' : '[捕获]'} ${method} ${url}`, `color:${hot ? '#ff5722' : '#4caf50'};font-weight:bold;font-size:13px`);
        console.log('  📤 请求体:', item.请求体);
        console.log('  📥 状态:', status, ' 响应:', item.响应);
        console.log('  ────────────────────────────');
    }

    // 1. 拦截 XMLHttpRequest（jQuery $.post/$.ajax 都走这里）
    const _open = XMLHttpRequest.prototype.open;
    const _send = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.open = function (m, u, ...rest) {
        this.__capM = m; this.__capU = u;
        return _open.call(this, m, u, ...rest);
    };
    XMLHttpRequest.prototype.send = function (body) {
        this.addEventListener('load', () => record(this.__capM, this.__capU, body, this.status, this.responseText));
        return _send.call(this, body);
    };

    // 2. 拦截 fetch
    const _fetch = window.fetch;
    if (_fetch) {
        window.fetch = async function (url, opt = {}) {
            const resp = await _fetch.call(this, url, opt);
            try { record(opt.method || 'GET', String(url), opt.body, resp.status, await resp.clone().text()); } catch (e) {}
            return resp;
        };
    }

    // 3. 拦截表单提交（防止网页用传统 form 提交）
    document.addEventListener('submit', (e) => {
        const f = e.target;
        record('FORM', f.action, new URLSearchParams(new FormData(f)).toString(), '?', '(表单提交)');
    }, true);

    console.log('%c══════════════════════════════════════════', 'color:#ff9800;font-size:14px');
    console.log('%c 抓包已启动 ✅', 'color:#ff9800;font-size:14px;font-weight:bold');
    console.log('%c══════════════════════════════════════════', 'color:#ff9800;font-size:14px');
    console.log('请现在做以下操作：');
    console.log('  1️⃣  手动在一道【填空题】里打字，然后点击页面空白处（触发保存）');
    console.log('  2️⃣  再切到下一题（切题时网页通常也会保存）');
    console.log('  3️⃣  观察下方出现的 🔥[重点] 或 [捕获] 记录');
    console.log('');
    console.log('全部做完后：在控制台输入 __captured 回车可以看到汇总');
    console.log('把标 🔥[重点] 的记录（URL + 请求体 + 响应）截图或复制发给我');
})();
