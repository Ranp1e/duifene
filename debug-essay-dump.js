/**
 * 对分易 — 问答题页信息采集 + 保存请求抓包（一次性调试脚本）
 *
 * 用法：
 *   1. 在 Edge 里打开含【问答题/主观题】的试卷，切到一道问答题
 *   2. 按 F12 → 点"控制台"(Console) → 粘贴本文件全部内容 → 回车
 *      （若 Edge 提示"禁止粘贴代码"，先手动输入 allow pasting 回车，再粘贴）
 *   3. 看到"第1部分已复制"后，直接到 Kimi 对话框 Ctrl+V 粘贴发送
 *   4. 然后手动在问答题输入框里随便打几个字 → 点"保存"（没有保存按钮就点"下一题"）
 *   5. 回到控制台输入 __report() 回车 → 再 Ctrl+V 粘贴发送
 */
(function () {
    const info = {};
    const txt = id => document.getElementById(id)?.textContent?.trim() ?? null;

    info['题型'] = txt('subjectType');
    info['题号'] = txt('itemIndex');
    info['总题数'] = txt('allIndex');
    info['题干'] = (txt('divSubjectName') || '').substring(0, 120);

    // 所有隐藏域（保存接口需要的 ID 通常在这里）
    info['隐藏域'] = {};
    document.querySelectorAll('input[type="hidden"]').forEach(el => {
        const v = el.value || '';
        info['隐藏域'][el.id || el.name] = v.length > 120 ? v.substring(0, 120) + `...(共${v.length}字符)` : v;
    });

    // UEditor 富文本编辑器状态
    info['UEditor存在'] = typeof UE !== 'undefined';
    info['UEditor实例'] = (typeof UE !== 'undefined' && UE.instants) ? Object.keys(UE.instants) : [];
    info['UEditor就绪'] = info['UEditor实例'].map(k => ({ id: k, ready: !!(UE.instants[k] && UE.instants[k].ready) }));

    // 所有 textarea / 可编辑元素 / iframe（找真正的输入框在哪）
    info['textarea列表'] = [...document.querySelectorAll('textarea')].map(t => ({
        id: t.id, name: t.name, 可见: !!t.offsetParent, 前20字: (t.value || '').substring(0, 20)
    }));
    info['contenteditable'] = [...document.querySelectorAll('[contenteditable="true"]')].map(e => ({
        标签: e.tagName, id: e.id, class: String(e.className || '').substring(0, 40)
    }));
    info['iframe列表'] = [...document.querySelectorAll('iframe')].map(f => ({ id: f.id, src: (f.src || '').substring(0, 60) }));

    // 选项容器与 data-sid（现有脚本就是在这里取不到 SubjectID）
    const item = document.getElementById('divSubjectItem');
    info['divSubjectItem存在'] = !!item;
    info['divSubjectItem片段'] = item ? item.innerHTML.replace(/\s+/g, ' ').substring(0, 800) : null;
    info['data-sid元素'] = [...document.querySelectorAll('[data-sid]')].map(e => e.tagName + ':' + e.getAttribute('data-sid')).slice(0, 5);

    // 答题卡格子（跳题用）与页面全局函数
    const cell = document.querySelector('#answerSheet .viewTab > div');
    info['答题卡格子示例'] = cell ? cell.outerHTML.substring(0, 200) : null;
    info['全局函数'] = {};
    ['Sub_Next', 'SubmitPaper', 'SaveSubject', 'To_Sub', 'FromGoTo', 'FillAnswer'].forEach(fn => {
        info['全局函数'][fn] = typeof window[fn];
    });

    // ===== 抓包：拦截之后你手动保存时网页真实发出的请求 =====
    window.__cap = [];
    const rec = (m, u, b, s, r) => {
        if (!/POST|PUT/i.test(m)) return;
        if (/\.(js|css|png|jpg|gif|svg|ico|woff)/i.test(u)) return;
        window.__cap.push({ 方法: m, URL: u, 请求体: String(b ?? '').substring(0, 500), 状态: s, 响应: String(r ?? '').substring(0, 200) });
        console.log('🔥 捕获到请求:', m, u);
    };
    const _open = XMLHttpRequest.prototype.open, _send = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.open = function (m, u, ...r) { this.__m = m; this.__u = u; return _open.call(this, m, u, ...r); };
    XMLHttpRequest.prototype.send = function (b) { this.addEventListener('load', () => rec(this.__m, this.__u, b, this.status, this.responseText)); return _send.call(this, b); };
    const _f = window.fetch;
    if (_f) window.fetch = async (u, o = {}) => { const r = await _f(u, o); try { rec(o.method || 'GET', String(u), o.body, r.status, await r.clone().text()); } catch (e) {} return r; };

    window.__report = function () {
        const s = JSON.stringify({ 静态信息: info, 抓到的请求: window.__cap }, null, 2);
        try { copy(s); } catch (e) {}
        console.log('✅ 已复制全部信息到剪贴板，直接 Ctrl+V 粘贴发给AI');
        return s;
    };

    try { copy(JSON.stringify(info, null, 2)); } catch (e) {}
    console.log('✅ 第1部分（页面静态信息）已复制到剪贴板 → 现在就可以 Ctrl+V 发给AI');
    console.log('👉 然后手动操作：在问答题输入框里打几个字 → 点"保存"（没有保存按钮就点"下一题"）');
    console.log('👉 操作完回到这里输入 __report() 回车 → 再 Ctrl+V 发给AI');
})();
