/**
 * 对分易填空 — 全页扫描（找真正的输入框在哪）
 * F12 Console 粘贴执行
 */
(async function() {
    const H=(t)=>console.log(`\n%c【${t}】`,'color:#ff9800;font-size:15px;font-weight:bold');
    const L=(t,m,ok=true)=>{const i=ok?'✅':'❌';console.log(`%c${i} ${t}%c ${m}`,`color:${ok?'#4caf50':'#f44336'};font-weight:bold`,'color:#ccc');};

    console.clear();
    console.log('%c══════════════════════════════════════','color:#ff9800;font-size:15px');
    console.log('%c 对分易填空 — 全页扫描找输入框','color:#ff9800;font-size:15px');
    console.log('%c══════════════════════════════════════','color:#ff9800;font-size:15px');

    // 1. 题型
    H('1. 题型');
    console.log('题型:', document.getElementById('subjectType')?.textContent?.trim());
    console.log('题目:', document.getElementById('divSubjectName')?.textContent?.trim()?.substring(0,80));

    // 2. ★ 全页所有 input/textarea/contenteditable
    H('2. 全页 input/textarea/contenteditable');
    const all = document.querySelectorAll('input, textarea, [contenteditable="true"]');
    console.log(`共找到 ${all.length} 个:`);
    all.forEach((el,i)=>{
        const sty=window.getComputedStyle(el);
        const vis=!(el.style.display==='none'||sty.display==='none'||sty.visibility==='hidden'||el.offsetParent===null);
        console.log(`%c  [${i}] %c<${el.tagName.toLowerCase()}> id="${el.id}" name="${el.getAttribute('name')}" type="${el.type}" placeholder="${el.placeholder?.substring(0,20)}" visible=${vis} value="${(el.value||'').substring(0,40)}"`,
            vis?'color:#ffeb3b':'color:#888','color:#ccc');
        if(el.closest && el.closest('#divSubjectItem')) console.log('        ↳ 在 #divSubjectItem 内');
        if(el.closest && el.closest('.subject-fillblank')) console.log('        ↳ 在 .subject-fillblank 内');
    });

    // 3. #divSubjectItem 完整 HTML
    H('3. #divSubjectItem 完整 HTML');
    const item=document.getElementById('divSubjectItem');
    if(item) {
        console.log(item.innerHTML.substring(0, 3000));
    } else {
        console.log('❌ #divSubjectItem 不存在！');
        // 找 nearby 结构
        const main=document.getElementById('subjectMain');
        if(main) console.log('#subjectMain innerHTML:', main.innerHTML.substring(0, 2000));
    }

    // 4. fillblank 容器
    H('4. .subject-fillblank 容器');
    const fb=document.querySelector('.subject-fillblank');
    if(fb) {
        console.log('✅ 存在');
        console.log('innerHTML:', fb.innerHTML.substring(0, 2000));
        const childInputs=fb.querySelectorAll('input, textarea');
        console.log(`包含 ${childInputs.length} 个 input/textarea`);
    } else {
        console.log('❌ 不存在');
        // 检查所有以 subject- 开头的 class
        document.querySelectorAll('[class*="subject"]').forEach(el=>{
            console.log('  subject类:', el.className?.substring?.(0,80));
        });
    }

    // 5. ★ 尝试直接改 value 并观察 React/Vue 反应
    H('5. 尝试写入 + 观察');
    
    // 找到实际可见的输入
    const visibleInputs=[...all].filter(el=>{
        if(el.style.display==='none') return false;
        if(el.closest('[style*="display:none"]')) return false;
        return true;
    });

    if(visibleInputs.length===0) {
        console.log('❌ 没有可见输入元素！');
        // 尝试找 iframe
        const iframes=document.querySelectorAll('iframe');
        console.log(`页面有 ${iframes.length} 个 iframe:`);
        iframes.forEach((f,i)=>{
            console.log(`  [${i}] id="${f.id}" src="${f.src?.substring(0,80)}"`);
        });
    } else {
        const inp=visibleInputs[0];
        console.log(`%c  🧪 测试: <${inp.tagName}> id="${inp.id}"`,'color:#ffeb3b');
        console.log(`  当前 value: "${inp.value}"`);
        
        // ★ 检查是否是 React 组件
        const reactKeys=Object.keys(inp).filter(k=>k.startsWith('__react'));
        const vueKeys=Object.keys(inp).filter(k=>k.startsWith('__vue'));
        if(reactKeys.length) console.log(`%c  🔥 React 组件! keys: ${reactKeys.join(',')}`,'color:#00bcd4');
        if(vueKeys.length) console.log(`%c  🔥 Vue 组件! keys: ${vueKeys.join(',')}`,'color:#00bcd4');
        
        // 检查 __reactProps
        if(reactKeys.length) {
            const fiber=inp[reactKeys[0]];
            console.log('  React fiber:', fiber?.tag, fiber?.elementType?.name||fiber?.elementType, 'pendingProps:', fiber?.pendingProps);
            // React 的 onChange handler
            const onChange=fiber?.pendingProps?.onChange||fiber?.memoizedProps?.onChange;
            const onInput=fiber?.pendingProps?.onInput||fiber?.memoizedProps?.onInput;
            console.log(`  React onChange: ${!!onChange}, onInput: ${!!onInput}`);
            if(onChange) {
                console.log('  ... 尝试直接调 React onChange ...');
                try{
                    const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;
                    setter.call(inp,'React测试');
                    onChange({target:inp,currentTarget:inp,bubbles:true});
                    console.log(`  调用后 value="${inp.value}"`);
                }catch(e){console.log('  调用失败:',e.message);}
            }
        }
        
        if(!reactKeys.length && !vueKeys.length) {
            console.log('  不是 React/Vue 组件，可能是原生元素');

            // 检查事件监听器
            console.log('  检查事件监听器...');
            try {
                if(typeof $!=='undefined'&&$._data) {
                    const evts=$._data(inp,'events');
                    if(evts) {
                        console.log(`  jQuery events: ${Object.keys(evts).join(', ')}`);
                        Object.keys(evts).forEach(name=>{
                            console.log(`    ${name}: ${evts[name].length} 个 handler`);
                            evts[name].forEach((h,i)=>{
                                console.log(`      handler[${i}] origin: ${h.handler?.toString?.()?.substring(0,80)}`);
                            });
                        });
                    }
                }
            } catch(e) { console.log('  无法读取 jQuery 事件:', e.message); }

            // 尝试 getEventListeners (Chrome DevTools only)
            try {
                const listeners=getEventListeners(inp);
                if(listeners) {
                    console.log(`  原生事件: ${Object.keys(listeners).join(', ')}`);
                    Object.keys(listeners).forEach(name=>{
                        console.log(`    ${name}: ${listeners[name].length} 个, useCapture=${listeners[name][0]?.useCapture}`);
                    });
                }
            } catch(e) { /* getEventListeners not available outside DevTools */ }
        }
    }

    // 6. 查找字符统计元素
    H('6. 字符统计元素');
    const elWithNum=document.querySelectorAll('[id*="count"],[class*="count"],[id*="word"],[class*="word"],[id*="char"],[class*="char"]');
    console.log(`找到 ${elWithNum.length} 个可能的字符计数元素`);
    elWithNum.forEach(el=>{
        console.log(`  %c<${el.tagName}> id="${el.id}" class="${el.className?.substring?.(0,60)}" text="${el.textContent?.trim?.()}"`,'color:#aaa');
    });

    console.log('\n%c══════════════════════════════════════','color:#ff9800;font-size:15px');
    console.log('%c 扫描完毕。截屏全部输出 + 页面截图发我。','color:#ff9800;font-size:15px');
    console.log('%c 重点: 找到真正的输入框是什么','color:#ffeb3b');
    console.log('%c══════════════════════════════════════','color:#ff9800;font-size:15px');
})();
