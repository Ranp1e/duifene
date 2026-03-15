// ==UserScript==
// @name         对分易自动答题助手
// @namespace    https://github.com/duifene-auto-answer
// @version      5.3.0
// @description  对分易自动答题 v5.3 — 慢速版：多选逐项600ms+填空逐空500ms+默认延时2s
// @author       duifene-helper
// @match        https://www.duifene.com/*
// @match        https://www.duifene.com/_Paper/PC/*
// @grant        GM_xmlhttpRequest
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_addStyle
// @connect      api.deepseek.com
// @connect      www.duifene.com
// @license      MIT
// ==/UserScript==

(function () {
    'use strict';

    // ==================== 配置 ====================
    const K = { DS_KEY:'df48_key', DS_MODEL:'df48_model', CACHE:'df48_cache', DELAY:'df48_delay', AUTO_SUBMIT:'df48_asub', AUTO_RETURN:'df48_aret' };
    const D = { DS_MODEL:'deepseek-v4-pro', DELAY:2000, AUTO_SUBMIT:false, AUTO_RETURN:true };
    const getCfg = (k) => { const v = GM_getValue(k); return v !== undefined ? v : D[k]; };
    const setCfg = (k,v) => GM_setValue(k,v);

    // ==================== 终端浮窗 ====================
    let tPanel=null, tBody=null;
    function initTerminal() {
        const old=document.getElementById('df48-term'); if(old) old.remove();
        tPanel=document.createElement('div'); tPanel.id='df48-term';
        tPanel.innerHTML=`<div class="df48-th" id="df48-th"><span>🖥️ 答题日志</span><span style="display:flex;gap:6px"><span id="df48-stats" style="font-weight:400;font-size:11px"></span><span style="cursor:pointer" id="df48-clr" title="清屏">🗑</span></span></div><div class="df48-tb" id="df48-tb"></div><div class="df48-ts" id="df48-ts"></div>`;
        document.body.appendChild(tPanel); tBody=document.getElementById('df48-tb');
        dragEl(tPanel, document.getElementById('df48-th'));
        document.getElementById('df48-clr').addEventListener('click',()=>{tBody.innerHTML='';updateStats(0,0);});
    }
    function tLog(type,msg) {
        if(!tBody) return;
        const m={info:['ℹ️','#94a3b8'],q:['📝','#82b1ff'],ok:['✅','#69f0ae'],fail:['❌','#ff5252'],ai:['🤖','#ffd740'],cache:['💾','#40c4ff'],next:['➡️','#b2ff59'],title:['━','#ea80fc'],submit:['📤','#ff8a65'],save:['💿','#ff80ab']};
        const [icon,color]=m[type]||['','#eee'];
        const line=document.createElement('div');
        line.style.cssText=`padding:1px 8px;font-size:11px;color:${color};font-family:Consolas,'Courier New',monospace;white-space:pre-wrap;word-break:break-all`;
        line.textContent=`${icon} ${msg}`; tBody.appendChild(line); tBody.scrollTop=tBody.scrollHeight;
        while(tBody.children.length>200) tBody.firstChild.remove();
    }
    function updateStats(ok,fail) { const s=document.getElementById('df48-stats'); if(s) s.innerHTML=`<span style="color:#69f0ae">✅${ok}</span> <span style="color:#ff5252">❌${fail}</span>`; }
    function renderSheet(total,curIdx,answered) {
        const sheet=document.getElementById('df48-ts'); if(!sheet) return;
        let h='<div style="font-size:11px;color:#94a3b8;margin-bottom:4px">📋 答题卡</div><div style="display:flex;flex-wrap:wrap;gap:4px">';
        for(let i=1;i<=total;i++) {
            let cls='df48-sq'; if(answered.has(i)) cls+=' df48-sq-done'; if(i===curIdx) cls+=' df48-sq-cur';
            h+=`<div class="${cls}" data-n="${i}" title="第${i}题${answered.has(i)?' ✅':''}">${i}</div>`;
        }
        h+='</div>'; sheet.innerHTML=h;
        sheet.querySelectorAll('.df48-sq').forEach(el=>{el.addEventListener('click',()=>{const n=parseInt(el.dataset.n);if(n>0&&typeof To_Sub==='function'){To_Sub(n);tLog('info',`跳转到第 ${n} 题`);}});});
    }

    // ==================== 工具 ====================
    const sleep=ms=>new Promise(r=>setTimeout(r,ms));
    function toast(msg,dur=2000){const el=document.createElement('div');el.textContent=msg;el.style.cssText='position:fixed;top:20px;left:50%;transform:translateX(-50%);z-index:99999;background:rgba(0,0,0,0.85);color:#fff;padding:10px 24px;border-radius:8px;font-size:14px;pointer-events:none;transition:opacity 0.3s';document.body.appendChild(el);setTimeout(()=>{el.style.opacity='0';setTimeout(()=>el.remove(),300)},dur);}
    function hashKey(q,t){const s=q.replace(/\s+/g,' ').trim()+'|'+t;let h=0;for(let i=0;i<s.length;i++){h=((h<<5)-h)+s.charCodeAt(i);h|=0;}return'df48_'+h.toString(36);}
    function getCache(){try{return JSON.parse(GM_getValue(K.CACHE,'{}'));}catch(e){return{};}}
    function saveCache(c){GM_setValue(K.CACHE,JSON.stringify(c));}
    function getCached(q,t){const c=getCache();return c[hashKey(q,t)]||null;}
    function setCached(q,t,ans){const c=getCache();c[hashKey(q,t)]={a:ans,tm:Date.now()};const e=Object.entries(c);if(e.length>500){e.sort((a,b)=>(b[1].tm||0)-(a[1].tm||0));const nc={};e.slice(0,500).forEach(([k,v])=>{nc[k]=v;});saveCache(nc);return;}saveCache(c);}
    function stripHtml(s){const d=document.createElement('div');d.innerHTML=s;return d.textContent||'';}
    function clean(s){return(s||'').replace(/[\s\u3000]+/g,'').replace(/[，,]/g,',').replace(/[；;]/g,';').replace(/[（）()]/g,'').replace(/[""''「」『』《》<>]/g,'').toLowerCase().trim();}

    // ==================== 页面数据 ====================
    function getCurrentQuestion() {
        const nameEl=document.getElementById('divSubjectName'), typeEl=document.getElementById('subjectType');
        const idxEl=document.getElementById('itemIndex'), allEl=document.getElementById('allIndex');
        if(!nameEl||!typeEl) return null;
        const qText=stripHtml(nameEl.innerHTML)||nameEl.textContent.trim();
        const typeText=(typeEl.textContent||'').trim();
        const curIdx=parseInt(idxEl?.textContent)||1, total=parseInt(allEl?.textContent)||0;
        let typeId=2;
        if(/多选/.test(typeText)) typeId=3; else if(/判断/.test(typeText)) typeId=1;
        else if(/问答|简答|主观/.test(typeText)) typeId=5; else if(/填空/.test(typeText)) typeId=4;
        else if(/单选/.test(typeText)) typeId=2;
        return{qText,typeText,typeId,curIdx,total};
    }
    function getCurrentOptions(){
        const container=document.getElementById('divSubjectItem'); if(!container) return[];
        const anchors=container.querySelectorAll('a[data-v]'); const opts=[];
        anchors.forEach(a=>{const label=a.getAttribute('data-v');const divs=a.querySelectorAll('div');const td=divs.length>=2?divs[1]:(divs.length===1?divs[0]:null);const text=td?td.textContent.trim():'';if(label) opts.push({label,text,el:a});});
        return opts;
    }

    // ==================== ★ 核心：保存答案 ★ ====================

    /** 通过 triggerHandler 直接调用页面 jQuery handler（绕过 isTrusted） */
    function clickViaHandler(optEl) {
        if(!optEl) return false;
        try {
            if(typeof $!=='undefined' && $.fn) {
                // triggerHandler 直接调用 jQuery 绑定的函数，不走 DOM dispatch
                // 这是绕过 isTrusted 的关键：handler 函数被直接调用，不是通过事件对象
                $(optEl).triggerHandler('click');
                console.log('[对分易] ✅ triggerHandler: ' + optEl.getAttribute('data-v'));
                return true;
            }
        } catch(e) { /* ignore */ }
        return false;
    }

    /** 从 hidS 反查当前显示的题目 sid */
    function getCurrentSid() {
        const container=document.getElementById('divSubjectItem'); if(!container) return null;
        const a=container.querySelector('a[data-sid]'); if(a) return a.getAttribute('data-sid');
        const btn=container.querySelector('button[data-sid]'); if(btn) return btn.getAttribute('data-sid');
        const idx=parseInt(document.getElementById('itemIndex')?.textContent)||1;
        try{const s=JSON.parse(document.getElementById('hidS').value);return s[idx-1]?.SubjectID?.toString()||null;}catch(e){return null;}
    }

    /** 尝试发 AJAX 保存到对分易后端 */
    function ajaxSave(sid, answer) {
        const userPaperID=document.getElementById('hidUserPaperID')?.value;
        const histPaperID=document.getElementById('hidHistPaperID')?.value;
        if(!userPaperID || !histPaperID) return false;
        if(typeof $==='undefined') return false;

        let url='', data={};

        // 从 studpaper.js 推测可能的 API
        // 方式1：对分易常见的 .ashx 保存
        const m=location.pathname.match(/(\/_Paper\/PC\/)/);
        const base=m ? m[1] : '/';

        // 多个可能的路径同时尝试
        const urls=[
            '/AppCode/StudentPaper.ashx',
            '/_Paper/PC/StudentPapers.aspx/SaveSubject',
            '/AppCode/Paper.ashx',
        ];
        const payloads=[
            {action:'save',userPaperID,histPaperID,subjectID:sid,answer},
            {action:'saveanswer',upid:userPaperID,hpid:histPaperID,sid,ans:answer},
            {action:'setsubject',UserPaperID:userPaperID,HistPaperID:histPaperID,SubjectID:sid,Answer:answer},
        ];

        urls.forEach((u,i)=>{try{$.post(u,payloads[i]);}catch(e){}});
        console.log('[对分易] AJAX → 已发送保存请求');
        return true;
    }

    /** 主入口：保存答案 */
    function saveAnswer(sid, answer, matchedLabels, isEssay) {
        // 方法1：对于有选项的题目，用 triggerHandler 触发真实 handler
        //        这是让页面"转圈"保存的关键
        if(!isEssay && matchedLabels && matchedLabels.length>0) {
            const container=document.getElementById('divSubjectItem');
            if(container) {
                const anchors=container.querySelectorAll('a[data-v]');
                const labelSet=new Set(matchedLabels);

                // 先清掉其他选项的 itemDone
                anchors.forEach(a=>{
                    const v=a.getAttribute('data-v');
                    if(!labelSet.has(v)) {
                        a.classList.remove('itemDone'); a.classList.add('itemDefault');
                    }
                });

                // 用 triggerHandler 点击目标选项（绕过 isTrusted）
                anchors.forEach(a=>{
                    const v=a.getAttribute('data-v');
                    if(labelSet.has(v)) {
                        clickViaHandler(a);
                    }
                });
                tLog('save', `triggerHandler → ${matchedLabels.join(',')}`);
            }
        }

        // 方法2：问答题 — 同步 UEditor → textarea → AJAX
        if(isEssay) {
            const ta=document.getElementById('ueditor_textarea_editorValue');
            if(ta) {
                const setter=Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set;
                setter.call(ta, answer);
                ta.dispatchEvent(new Event('input',{bubbles:true}));
                ta.dispatchEvent(new Event('change',{bubbles:true}));
                ta.dispatchEvent(new Event('blur',{bubbles:true}));
            }
            tLog('save', '问答题 → textarea + AJAX');
        }

        // 方法3：AJAX 兜底保存
        ajaxSave(sid, answer);

        // 方法4：更新答题卡视觉
        try {
            const sheetEl=document.getElementById('answerSheet');
            if(sheetEl) {
                const curIdx=parseInt(document.getElementById('itemIndex')?.textContent)||1;
                const divs=sheetEl.querySelectorAll('.viewTab>div');
                if(divs[curIdx-1]){divs[curIdx-1].classList.remove('undo');divs[curIdx-1].classList.add('done');}
            }
        } catch(e) {}

        return true;
    }

    // ==================== AI API ====================
    async function callDeepSeek(qText, options, typeId) {
        const apiKey=getCfg(K.DS_KEY), model=getCfg(K.DS_MODEL);
        if(!apiKey) throw new Error('请先设置 API Key');

        let prompt;
        if(typeId===5) {
            prompt=`【问答题】\n题目：${qText}\n\n请直接返回完整的答案内容，简洁准确。只返回答案，不解释。`;
        } else if(typeId===1) {
            const os=options.map(o=>`${o.label}. ${o.text}`).join('\n');
            prompt=`【判断题】\n题目：${qText}\n\n选项：\n${os}\n\n请判断对错，只返回"对"或"错"。`;
        } else if(typeId===3) {
            const os=options.map(o=>`  ${o.label}. ${o.text}`).join('\n');
            prompt=`【多选题】请仔细阅读题目和每一个选项，选出所有正确的选项（可能不止一个）。\n\n题目：${qText}\n\n全部选项如下：\n${os}\n\n请只返回正确选项的字母，多个字母用逗号分隔（如：A,C,D）。只返回字母。`;
        } else {
            const os=options.map(o=>`  ${o.label}. ${o.text}`).join('\n');
            prompt=`【单选题】请仔细阅读题目，从以下选项中选出唯一正确的答案。\n\n题目：${qText}\n\n选项：\n${os}\n\n请只返回一个正确选项的字母（如：A）。只返回字母。`;
        }

        return new Promise((resolve,reject)=>{
            GM_xmlhttpRequest({
                method:'POST', url:'https://api.deepseek.com/v1/chat/completions',
                headers:{'Content-Type':'application/json','Authorization':`Bearer ${apiKey}`},
                data:JSON.stringify({model:model,messages:[
                    {role:'system',content:'你是专业答题助手。请仔细分析题目和选项，给出准确答案。严格按要求输出。'},
                    {role:'user',content:prompt},
                ],temperature:0.05,max_tokens:typeId===5?2000:600}),
                timeout:30000,
                onload:(resp)=>{try{const b=JSON.parse(resp.responseText);if(b.error){reject(new Error(b.error.message));return;}resolve(b.choices[0].message.content.trim());}catch(e){reject(new Error('解析失败'));}},
                onerror:()=>reject(new Error('网络错误')),
                ontimeout:()=>reject(new Error('超时')),
            });
        });
    }

    function matchAnswer(aiAnswer, options, typeId) {
        const cleaned=aiAnswer.trim();
        if(typeId===4||typeId===5) return[];
        if(typeId===1){const isTrue=/^(对|正确|是|true|yes|√|t|right)$/i.test(cleaned);const opt=options.find(o=>clean(o.text)===(isTrue?'对':'错'));return opt?[opt.label]:[];}
        const lm=cleaned.match(/^[A-Da-d](,[A-Da-d])*$/); if(lm){const ls=lm[0].split(',').map(s=>s.trim().toUpperCase());const vs=new Set(options.map(o=>o.label));const m=[...new Set(ls)].filter(l=>vs.has(l));if(m.length>0)return typeId===2?[m[0]]:m;}
        const al=cleaned.match(/[A-Da-d]/g); if(al){const us=[...new Set(al.map(l=>l.toUpperCase()))];const vs=new Set(options.map(o=>o.label));const m=us.filter(l=>vs.has(l));if(m.length>0)return typeId===2?[m[0]]:m;}
        for(const opt of options){if(clean(cleaned)===clean(opt.text))return[opt.label];if(clean(cleaned).includes(clean(opt.text))||clean(opt.text).includes(clean(cleaned))){if(typeId===2)return[opt.label];}}
        return[];
    }

    // ==================== 填充 ====================
    async function fillBlankSlow(aiAnswer) {
        const fbContainer = document.querySelector('.subject-fillblank');
        if (!fbContainer) { console.log('[对分易] fillBlank: 未找到 .subject-fillblank'); return false; }

        const inputs = fbContainer.querySelectorAll('input[type="text"], input:not([type])');
        console.log(`[对分易] fillBlank: .subject-fillblank 内找到 ${inputs.length} 个填空输入`);
        if (inputs.length === 0) return false;

        const answers = aiAnswer.split(/[;；\n]/).map(s => s.replace(/^\d+[.、．)\s]*/, '').trim()).filter(Boolean);
        let filled = false;

        for (let i = 0; i < inputs.length; i++) {
            const inp = inputs[i];
            const ans = answers[i] || answers[answers.length - 1] || '';
            if (!ans) continue;
            console.log(`[对分易] fillBlank[${i}]: id="${inp.id}" ← "${ans.substring(0,40)}"`);

            // 1. focus + 写值
            inp.focus();
            const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
            setter.call(inp, ans);
            await sleep(200);  // 让页面感应到值变化

            // 2. inline onchange
            try { if (typeof inp.onchange === 'function') { inp.onchange(); } } catch(e) {}
            // 3. window.FillAnswer
            try { if (typeof FillAnswer === 'function') { FillAnswer(inp); } } catch(e) {}
            // 4. jQuery triggerHandler
            try { if (typeof $ !== 'undefined') { $(inp).triggerHandler('change'); $(inp).triggerHandler('keyup'); } } catch(e) {}
            // 5. 事件链
            inp.dispatchEvent(new Event('input', { bubbles: true }));
            inp.dispatchEvent(new Event('change', { bubbles: true }));
            inp.dispatchEvent(new Event('keyup', { bubbles: true }));

            inp.style.border = '2px solid #52c41a';
            inp.style.backgroundColor = '#e6fffb';
            filled = true;

            // 每个空之间等待 500ms
            await sleep(500);
        }

        console.log(`[对分易] fillBlank: 完成`);
        return filled;
    }

    function fillBlank(aiAnswer) {
        const fbContainer = document.querySelector('.subject-fillblank');
        if (!fbContainer) { console.log('[对分易] fillBlank: 未找到 .subject-fillblank'); return false; }

        const inputs = fbContainer.querySelectorAll('input[type="text"], input:not([type])');
        console.log(`[对分易] fillBlank: .subject-fillblank 内找到 ${inputs.length} 个填空输入`);
        if (inputs.length === 0) return false;

        const answers = aiAnswer.split(/[;；\n]/).map(s => s.replace(/^\d+[.、．)\s]*/, '').trim()).filter(Boolean);
        let filled = false;

        inputs.forEach((inp, i) => {
            const ans = answers[i] || answers[answers.length - 1] || '';
            if (!ans) return;
            console.log(`[对分易] fillBlank[${i}]: id="${inp.id}" ← "${ans.substring(0,40)}"`);

            // 1. 写入 value
            const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
            setter.call(inp, ans);

            // 2. ★ 执行 inline onchange="FillAnswer(this)" — 直接调 DOM 属性
            try { if (typeof inp.onchange === 'function') { inp.onchange(); console.log('[对分易] inp.onchange() 已调用'); } } catch(e) {}
            // 3. ★ 也尝试 window.FillAnswer(inp)
            try { if (typeof FillAnswer === 'function') { FillAnswer(inp); console.log('[对分易] FillAnswer(inp) 已调用'); } } catch(e) {}

            // 4. jQuery triggerHandler('change') 调用 jQuery handler
            try { if (typeof $ !== 'undefined') { $(inp).triggerHandler('change'); console.log('[对分易] triggerHandler(change)'); } } catch(e) {}

            // 5. 事件链（冗余兜底）
            inp.focus();
            inp.dispatchEvent(new Event('input', { bubbles: true }));
            inp.dispatchEvent(new Event('change', { bubbles: true }));
            inp.dispatchEvent(new Event('keyup', { bubbles: true }));

            inp.style.border = '2px solid #52c41a';
            inp.style.backgroundColor = '#e6fffb';
            filled = true;
        });
        return filled;
    }

    function fillEssay(aiAnswer) {
        const htmlAnswer=aiAnswer.replace(/\n/g,'<p>').replace(/\r/g,'');

        // 1. UEditor
        try {
            if(typeof UE!=='undefined'&&UE.instants){for(const uid in UE.instants){const ue=UE.instants[uid];if(ue&&ue.body&&ue.ready){ue.setContent(htmlAnswer);try{ue.sync();}catch(e){}try{ue.fireEvent('contentChange');}catch(e){}}}}
        } catch(e) {}

        // 2. backing textarea
        const ta=document.getElementById('ueditor_textarea_editorValue');
        if(ta){const setter=Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set;setter.call(ta,aiAnswer);ta.dispatchEvent(new Event('input',{bubbles:true}));ta.dispatchEvent(new Event('change',{bubbles:true}));ta.dispatchEvent(new Event('blur',{bubbles:true}));}

        // 3. 降级textarea
        if(!ta){const all=document.querySelectorAll('textarea');for(const t of all){if(t.style.display==='none')continue;const s=Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set;s.call(t,aiAnswer);t.dispatchEvent(new Event('input',{bubbles:true}));t.dispatchEvent(new Event('change',{bubbles:true}));break;}}

        return true;
    }

    // ==================== 返回列表 ====================
    function goBackToList(){
        const opts={courseid:document.getElementById('Header_CourseID')?.value||'292154',classtype:document.getElementById('Header_ClassType')?.value||'2',classid:document.getElementById('sysClassID')?.value||'0',ebatchid:document.getElementById('hidEBatchID')?.value||'',moduleid:document.getElementById('Header_ModuleID')?.value||'19',histpaperid:document.getElementById('hidHistPaperID')?.value||''};
        try{if(typeof FromGoTo==='function'){FromGoTo('/_Paper/PC/PaperListSA.aspx',opts);}else{window.location.href=`https://www.duifene.com/_Paper/PC/PaperListSA.aspx?${new URLSearchParams(opts)}`;}}catch(e){window.location.href='https://www.duifene.com/_Paper/PC/PaperListSA.aspx';}
    }

    // ==================== 主流程 ====================
    let running=false, paused=false, answeredSet=new Set();

    async function autoAnswer(){
        if(running){toast('⏳正在答题中...');return;}
        const info=getCurrentQuestion(); if(!info){toast('⚠️未检测到题目');return;}
        saveUI(); initTerminal(); answeredSet.clear(); renderSheet(info.total,info.curIdx,answeredSet);
        tLog('title','══════════════════════════'); tLog('info',`v5.3 共${info.total}题 | 慢速版`); tLog('info',`默认延时${getCfg(K.DELAY)}ms | 逐项慢速点击`); tLog('title','══════════════════════════');
        running=true; paused=false; updateBtns();
        let okCount=0, failCount=0; const delay=getCfg(K.DELAY)||1200;

        for(let i=info.curIdx;i<=info.total;i++){
            if(paused){tLog('info','⏸️暂停');running=false;updateBtns();return;}
            await sleep(600);
            const cur=getCurrentQuestion(); if(!cur) break;
            const options=getCurrentOptions(); const sid=getCurrentSid();
            answeredSet.add(cur.curIdx); renderSheet(info.total,cur.curIdx,answeredSet);
            tLog('q',`Q${cur.curIdx}/${cur.total} [${cur.typeText}] ${cur.qText.substring(0,55)}...`);

            try {
                let answer=null, source='';
                const cached=getCached(cur.qText,cur.typeId);
                if(cached){answer=cached.a;source='💾缓存';tLog('cache',`命中→${answer.substring(0,100)}`);}
                if(!answer){tLog('ai','调用DeepSeek API...');answer=await callDeepSeek(cur.qText,options,cur.typeId);source='🤖AI';tLog('ai',`返回→${answer.substring(0,120)}`);if(answer) setCached(cur.qText,cur.typeId,answer);}

                let filled=false;
                if(cur.typeId===5){
                    // 问答题：UEditor + textarea + AJAX
                    fillEssay(answer);
                    filled=saveAnswer(sid, answer, [], true);
                    tLog(filled?'ok':'fail',`问答题写入${filled?'成功':'失败'}`);
                } else if(cur.typeId===4){
                    // 填空题：逐空填入，每个空之间慢一点
                    const fbIns=await fillBlankSlow(answer);
                    const saved=ajaxSave(sid, answer);
                    filled=fbIns;
                    tLog(filled?'ok':'fail',`填空${fbIns?'成功':'失败'}: ${answer.substring(0,40)} [${saved?'已发AJAX':'仅前端'}]`);
                } else if(options.length>0){
                    const matched=matchAnswer(answer,options,cur.typeId);
                    if(matched.length>0){
                        const answerStr=matched.join(',');
                        const isMulti=cur.typeId===3;

                        // ★ 逐个点击选项，多选每个之间慢一点 ★
                        const anchors=document.getElementById('divSubjectItem')?.querySelectorAll('a[data-v]');
                        if(anchors){
                            // 先清掉非目标选项的 itemDone
                            const labelSet=new Set(matched);
                            anchors.forEach(a=>{
                                const v=a.getAttribute('data-v');
                                if(!labelSet.has(v)) { a.classList.remove('itemDone'); a.classList.add('itemDefault'); }
                            });
                            // 逐个点击
                            for(const label of matched){
                                const target=[...anchors].find(a=>a.getAttribute('data-v')===label);
                                if(target){
                                    clickViaHandler(target);
                                    // 多选每个选项间停顿 600ms
                                    if(isMulti) await sleep(600);
                                }
                            }
                            // 所有点击完成后 400ms 等待
                            await sleep(400);
                        }
                        saveAnswer(sid, answerStr, matched, false);
                        filled=true;
                        tLog('ok', `已选:${matched.join(',')} → [${source}]${isMulti?' (慢速多选)':''}`);
                    } else {tLog('fail',`无法匹配→"${answer.substring(0,80)}"`);}
                }

                if(filled) okCount++; else failCount++;
                updateStats(okCount,failCount); renderSheet(info.total,cur.curIdx,answeredSet);
            } catch(err){failCount++;updateStats(okCount,failCount);tLog('fail',`出错:${err.message}`);}

            if(i<info.total){tLog('next',`→第${i+1}题`);await sleep(delay);try{if(typeof Sub_Next==='function')Sub_Next();}catch(e){}}
        }

        running=false;updateBtns();
        tLog('title','══════════════════════════');tLog('info',`完成✅${okCount}❌${failCount}/${info.total}`);tLog('title','══════════════════════════');
        toast(`✅完成！${okCount}/${info.total}`,3000);
        if(getCfg(K.AUTO_SUBMIT)&&okCount>0){tLog('submit','自动提交中...');await sleep(1500);try{if(typeof SubmitPaper==='function'){SubmitPaper();tLog('ok','已提交');}}catch(e){}if(getCfg(K.AUTO_RETURN)){await sleep(2000);tLog('next','返回列表');goBackToList();}}
    }

    function pauseResume(){if(running){paused=!paused;toast(paused?'⏸️暂停':'▶️继续');if(!paused){running=false;autoAnswer();}}}

    // ==================== UI ====================
    let panelEl=null;
    function initStyles(){GM_addStyle(`
.df48-panel{position:fixed;top:80px;right:16px;z-index:99999;background:#fff;border-radius:12px;box-shadow:0 6px 24px rgba(0,0,0,0.14);width:250px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:13px;overflow:hidden}
.df48-ph{background:linear-gradient(135deg,#4f46e5,#7c3aed);color:#fff;padding:12px 14px;font-weight:600;font-size:14px;display:flex;justify-content:space-between;align-items:center;cursor:move;user-select:none}
.df48-pb{padding:10px 14px}.df48-pb label{display:block;font-size:11px;color:#888;margin:8px 0 3px;font-weight:500}
.df48-pb input{width:100%;padding:7px 9px;border:1px solid #d9d9d9;border-radius:6px;font-size:12px;box-sizing:border-box}.df48-pb input:focus{border-color:#4f46e5;outline:none}
.df48-btn{display:block;width:100%;padding:9px 12px;margin:5px 0;border:none;border-radius:7px;font-size:13px;cursor:pointer;font-weight:500;text-align:center;transition:all 0.15s}
.df48-btn-go{background:linear-gradient(135deg,#4f46e5,#7c3aed);color:#fff}.df48-btn-go:hover{opacity:0.9;transform:translateY(-1px)}
.df48-btn-pause{background:#f59e0b;color:#fff}.df48-btn-pause:hover{background:#fbbf24}
.df48-btn-submit{background:#10b981;color:#fff}.df48-btn-submit:hover{background:#34d399}
.df48-btn-danger{background:#ef4444;color:#fff}.df48-btn-danger:hover{background:#f87171}
.df48-btn-back{background:#6366f1;color:#fff}.df48-btn-back:hover{background:#818cf8}
.df48-btn:disabled{opacity:0.45;cursor:not-allowed}
.df48-pb details{margin-top:4px}.df48-pb summary{font-size:11px;color:#888;cursor:pointer;user-select:none}
.df48-chk{display:flex;align-items:center;gap:6px;margin-top:8px;font-size:12px;color:#555}.df48-chk input{width:auto!important}
#df48-term{position:fixed;bottom:16px;right:16px;z-index:99998;background:#1e1e2e;border-radius:12px;box-shadow:0 6px 24px rgba(0,0,0,0.25);width:280px;max-height:400px;display:flex;flex-direction:column;font-family:Consolas,'Courier New',monospace}
.df48-th{background:#2d2d44;color:#cdd6f4;padding:6px 12px;font-size:12px;font-weight:600;border-radius:12px 12px 0 0;display:flex;justify-content:space-between;align-items:center;cursor:move;user-select:none}
.df48-tb{flex:1;overflow-y:auto;padding:3px 0;background:#1e1e2e;min-height:40px;max-height:180px}.df48-tb::-webkit-scrollbar{width:4px}.df48-tb::-webkit-scrollbar-thumb{background:#4f46e5;border-radius:2px}
.df48-ts{padding:8px 10px;border-top:1px solid #333;background:#1a1a2e;border-radius:0 0 12px 12px}
.df48-sq{display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;border-radius:5px;font-size:11px;background:#2d2d44;color:#94a3b8;cursor:pointer;transition:all 0.15s}
.df48-sq:hover{background:#4f46e5;color:#fff;transform:scale(1.1)}.df48-sq-done{background:#065f46;color:#69f0ae}.df48-sq-cur{box-shadow:0 0 0 2px #ffd740;color:#ffd740;font-weight:bold}
`);}
    function q(id){return document.getElementById(id);}
    function createPanel(){
        const old=document.querySelector('.df48-panel'); if(old) old.remove();
        panelEl=document.createElement('div'); panelEl.className='df48-panel';
        panelEl.innerHTML=`<div class="df48-ph" id="df48-head">🤖 对分易答题<span style="cursor:pointer;font-size:16px" id="df48-min">−</span></div><div class="df48-pb" id="df48-body"><label>🔑 DeepSeek API Key</label><input type="password" id="df48-key" placeholder="sk-..."><details><summary>⚙️ 更多设置</summary><label>📦 Model</label><input type="text" id="df48-model" placeholder="deepseek-v4-pro"><label>⏱️ 题间延时(ms)</label><input type="number" id="df48-delay" value="2000" min="300" max="10000"><div class="df48-chk"><input type="checkbox" id="df48-auto-submit"><span>答完后自动提交</span></div><div class="df48-chk"><input type="checkbox" id="df48-auto-return" checked><span>提交后返回练习列表</span></div></details><hr style="border:none;border-top:1px solid #f0f0f0;margin:8px 0"><button class="df48-btn df48-btn-go" id="df48-go">🚀 一键自动答题</button><button class="df48-btn df48-btn-pause" id="df48-pause">⏸️ 暂停</button><button class="df48-btn df48-btn-submit" id="df48-submit">📤 直接提交</button><button class="df48-btn df48-btn-back" id="df48-back">↩️ 返回列表</button><button class="df48-btn df48-btn-danger" id="df48-clear">🗑️ 清空缓存</button></div>`;
        document.body.appendChild(panelEl); dragEl(panelEl,q('df48-head'));
        const b=q('df48-body'); q('df48-min').addEventListener('click',()=>{const h=b.style.display==='none';b.style.display=h?'':'none';q('df48-min').textContent=h?'−':'+';});
        loadUI(); bindEvents();
    }
    function loadUI(){q('df48-key').value=getCfg(K.DS_KEY)||'';q('df48-model').value=getCfg(K.DS_MODEL)||D.DS_MODEL;q('df48-delay').value=getCfg(K.DELAY);q('df48-auto-submit').checked=getCfg(K.AUTO_SUBMIT);q('df48-auto-return').checked=getCfg(K.AUTO_RETURN);}
    function saveUI(){setCfg(K.DS_KEY,q('df48-key').value.trim());setCfg(K.DS_MODEL,q('df48-model').value.trim()||D.DS_MODEL);setCfg(K.DELAY,parseInt(q('df48-delay').value)||D.DELAY);setCfg(K.AUTO_SUBMIT,q('df48-auto-submit').checked);setCfg(K.AUTO_RETURN,q('df48-auto-return').checked);}
    function bindEvents(){
        q('df48-go').addEventListener('click',()=>{saveUI();autoAnswer();});
        q('df48-pause').addEventListener('click',()=>{saveUI();pauseResume();});
        q('df48-submit').addEventListener('click',()=>{if(confirm('确定提交试卷？')){try{if(typeof SubmitPaper==='function')SubmitPaper();toast('📤已提交');}catch(e){toast('提交失败');}}});
        q('df48-back').addEventListener('click',()=>{goBackToList();toast('↩️返回列表');});
        q('df48-clear').addEventListener('click',()=>{if(confirm('确定清空所有答案缓存？')){GM_setValue(K.CACHE,'{}');toast('✅已清空');}});
        ['df48-key','df48-model','df48-delay'].forEach(id=>{const el=q(id);el.addEventListener('blur',saveUI);el.addEventListener('change',saveUI);});
        q('df48-auto-submit').addEventListener('change',saveUI); q('df48-auto-return').addEventListener('change',saveUI);
    }
    function updateBtns(){const btn=q('df48-pause');if(!btn)return;if(paused){btn.textContent='▶️继续';btn.className='df48-btn';btn.style.background='#10b981';btn.style.color='#fff';}else{btn.textContent='⏸️暂停';btn.className='df48-btn df48-btn-pause';btn.style.background='';btn.style.color='';}}
    function dragEl(el,handle){let ox,oy,sx,sy;handle.addEventListener('mousedown',e=>{e.preventDefault();sx=e.clientX;sy=e.clientY;const r=el.getBoundingClientRect();ox=r.left;oy=r.top;const mm=e2=>{el.style.left=(ox+e2.clientX-sx)+'px';el.style.top=(oy+e2.clientY-sy)+'px';el.style.right='auto';el.style.bottom='auto';};const mu=()=>{document.removeEventListener('mousemove',mm);document.removeEventListener('mouseup',mu);};document.addEventListener('mousemove',mm);document.addEventListener('mouseup',mu);});}

    // ==================== 初始化 ====================
    function init(){console.log('[对分易]🚀v5.3 慢速版');initStyles();createPanel();initTerminal();tLog('title','══════════════════════════');tLog('info','v5.3 — 慢速版：多选600ms间隔 + 填空逐空500ms');tLog('info','默认题间延时2000ms，可调');tLog('title','══════════════════════════');toast('✅v5.3已就绪',2000);}
    if(document.readyState==='loading'){document.addEventListener('DOMContentLoaded',init);}else{init();}
})();
