import { getHealth, getProviders, providerHasEnvKey, testConnection } from '../api.js';
import { clearAllData, getSettings, listSessions, resetSettings, saveSettings } from '../store.js';
import { h, icon, modal, toast } from '../ui.js';

export async function renderSettings(ctx) {
  const providers = getProviders();
  let activeId = getSettings().provider;
  let keyVisible = false;
  let testing = false;
  const draft = {
    keys: { ...getSettings().keys },
    baseUrls: { ...getSettings().baseUrls },
    models: { ...getSettings().models },
  };

  const provider = () => providers.find((item) => item.id === activeId) || providers[0];
  const el = h('div', {});
  const tabs = h('div', { class: 'provider-tabs' });
  const panel = h('div', {});
  const testResult = h('div', { class: 'test-result' });
  const healthNote = h('div', { class: 'callout', style: 'margin-top:4px' });

  function persist(extra = {}) {
    saveSettings({
      provider: activeId,
      keys: { [activeId]: draft.keys[activeId] || '' },
      baseUrls: { [activeId]: draft.baseUrls[activeId] || provider().baseUrl },
      models: { [activeId]: draft.models[activeId] || provider().model },
      ...extra,
    });
  }

  function renderTabs() {
    tabs.replaceChildren(...providers.map((item) => h('button', {
      class: `provider-tab${item.id === activeId ? ' active' : ''}`,
      type: 'button',
      onclick: () => {
        activeId = item.id;
        persist();
        renderTabs();
        renderPanel();
      },
    }, h('strong', {}, item.label), h('span', {}, item.search === 'none' ? '搜索：维基兜底' : `搜索：${item.search}`))));
  }

  function renderPanel() {
    const meta = provider();
    const key = draft.keys[activeId] || '';
    const baseUrl = draft.baseUrls[activeId] || meta.baseUrl;
    const model = draft.models[activeId] || meta.model;
    const hasEnv = providerHasEnvKey(activeId);

    const keyInput = h('input', {
      class: 'input',
      type: keyVisible ? 'text' : 'password',
      value: key,
      placeholder: hasEnv ? '服务端已通过环境变量提供密钥（此处留空即可）' : 'sk-… 只保存在本机 localStorage',
      autocomplete: 'off',
      spellcheck: 'false',
      oninput: (event) => {
        draft.keys[activeId] = event.target.value.trim();
        persist();
        updateHealthNote();
      },
    });

    const baseInput = h('input', {
      class: 'input',
      type: 'url',
      value: baseUrl,
      spellcheck: 'false',
      onchange: (event) => {
        draft.baseUrls[activeId] = event.target.value.trim() || meta.baseUrl;
        persist();
      },
    });

    const modelInput = h('input', {
      class: 'input',
      type: 'text',
      value: model,
      list: 'model-options',
      spellcheck: 'false',
      onchange: (event) => {
        draft.models[activeId] = event.target.value.trim() || meta.model;
        persist();
      },
    });

    const modelList = h('datalist', { id: 'model-options' }, (meta.models || []).map((name) => h('option', { value: name })));

    const rate = getSettings().voiceRate;
    const rateInput = h('input', {
      type: 'range', min: '0.65', max: '1.2', step: '0.05', value: String(rate), 'aria-label': '语速',
      oninput: (event) => {
        const value = Number(event.target.value);
        persist({ voiceRate: value });
        rateValue.textContent = `${value.toFixed(2)}x`;
      },
    });
    const rateValue = h('span', { class: 'badge' }, `${Number(rate).toFixed(2)}x`);

    const voiceLang = h('select', {
      class: 'select',
      onchange: (event) => persist({ voiceLang: event.target.value }),
    }, [
      ['en-GB', '英式英语 en-GB'], ['en-US', '美式英语 en-US'], ['en-AU', '澳式英语 en-AU'],
    ].map(([value, label]) => h('option', { value, selected: getSettings().voiceLang === value }, label)));

    const aiToggle = h('input', {
      type: 'checkbox',
      checked: getSettings().aiMode !== 'off',
      onchange: (event) => {
        persist({ aiMode: event.target.checked ? 'auto' : 'off' });
        ctx.updateStatusPill();
        toast(event.target.checked ? 'AI 增强已开启' : '已切换为纯本地引擎', 'ok', 2000);
      },
    });

    panel.replaceChildren(
      h('div', { class: 'field' },
        h('label', {}, 'API Key ', hasEnv ? h('span', { class: 'badge ok' }, '环境变量可用') : h('span', { class: 'badge' }, '仅存本机')),
        h('div', { class: 'key-row' }, keyInput,
          h('button', { class: 'icon-round', type: 'button', 'aria-label': keyVisible ? '隐藏密钥' : '显示密钥', onclick: () => {
            keyVisible = !keyVisible;
            renderPanel();
          } }, h('span', { html: icon(keyVisible ? 'lock' : 'key', 17) })),
        ),
        h('div', { class: 'hint' }, '密钥只保存在浏览器 localStorage，并发送给本机的 EnOS 服务端转发；服务端不落盘、不写日志。'),
      ),
      h('div', { class: 'field-row' },
        h('div', { class: 'field' }, h('label', {}, 'Base URL'), baseInput,
          h('div', { class: 'hint' }, `默认 ${meta.baseUrl}`)),
        h('div', { class: 'field' }, h('label', {}, '模型'), modelInput, modelList,
          h('div', { class: 'hint' }, meta.models?.length ? `常用：${meta.models.join(' / ')}` : '填写服务商提供的模型 ID')),
      ),
      healthNote,
      h('div', { style: 'display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:6px' },
        h('button', { class: 'btn btn-primary btn-sm', type: 'button', onclick: runTest, disabled: testing }, testing ? '测试中…' : '测试连接'),
        h('button', { class: 'btn btn-ghost btn-sm', type: 'button', onclick: () => {
          draft.baseUrls[activeId] = meta.baseUrl;
          draft.models[activeId] = meta.model;
          persist();
          renderPanel();
          toast('已恢复默认地址与模型', 'ok', 1800);
        } }, '恢复默认'),
        meta.docs ? h('a', { class: 'link-btn', href: meta.docs, target: '_blank', rel: 'noreferrer' }, '获取 API Key ↗') : null,
      ),
      testResult,
      h('div', { class: 'field-row', style: 'margin-top:18px' },
        h('div', { class: 'field' }, h('label', {}, '朗读语速 ', rateValue), rateInput),
        h('div', { class: 'field' }, h('label', {}, '示范语音'), voiceLang),
      ),
      h('div', { class: 'switch-row' },
        h('div', {}, h('p', {}, 'AI 增强'), h('small', {}, '关闭后全程使用本地引擎：不发出任何模型请求。')),
        h('label', { class: 'switch' }, aiToggle, h('span', { class: 'track' }), h('span', { class: 'thumb' })),
      ),
    );
    updateHealthNote();
  }

  function updateHealthNote() {
    const meta = provider();
    const hasEnv = providerHasEnvKey(activeId);
    const typed = Boolean((draft.keys[activeId] || '').trim());
    if (hasEnv || typed) {
      healthNote.className = 'callout ok';
      healthNote.innerHTML = `${icon('check', 16)}<span>${hasEnv ? '服务端环境中检测到该服务商的密钥。' : '密钥已在本次会话中，可以点“测试连接”验证。'}</span>`;
    } else {
      healthNote.className = 'callout';
      healthNote.innerHTML = `${icon('info', 16)}<span>还没有 Key 也可以完整学习，只是不会做 AI 场景改写与 AI 评分。搜索会走维基百科兜底。</span>`;
    }
  }

  async function runTest() {
    if (testing) return;
    persist();
    testing = true;
    testResult.className = 'test-result';
    testResult.textContent = '正在请求…';
    renderPanel();
    try {
      const result = await testConnection(getSettings());
      testResult.className = 'test-result ok';
      testResult.textContent = `连接成功 · ${result.latency}ms · 模型 ${result.model || '—'}`;
      toast('连接成功', 'ok', 2000);
    } catch (error) {
      testResult.className = 'test-result err';
      testResult.textContent = `连接失败：${error.message}`;
      toast('连接失败，请检查 Key、Base URL 与模型名。', 'err', 4200);
    } finally {
      testing = false;
      renderTabs();
      renderPanel();
    }
  }

  const sessions = listSessions();
  const dataCard = h('div', { class: 'card settings-card' },
    h('h3', {}, h('span', { html: icon('trash', 18) }), '本机数据'),
    h('p', { class: 'small muted', style: 'margin-top:6px' }, `已保存 ${sessions.length} 份学习报告。清空后不可恢复。`),
    h('div', { style: 'display:flex;gap:8px;flex-wrap:wrap;margin-top:12px' },
      h('button', { class: 'btn btn-ghost btn-sm', type: 'button', onclick: async () => {
        const ok = await modal({ title: '清空本机数据？', body: '会删除所有 API Key、进行中的学习和历史报告。此操作不可撤销。', actions: [{ label: '取消', value: false }, { label: '清空', value: true, primary: true }] });
        if (!ok) return;
        clearAllData();
        resetSettings();
        ctx.updateStatusPill();
        toast('本机数据已清空', 'ok');
        ctx.navigate('home');
      } }, '清空全部数据'),
      h('button', { class: 'btn btn-ghost btn-sm', type: 'button', onclick: async () => {
        const ok = await modal({ title: '恢复默认设置？', body: '服务商、模型和语音设置会回到初始值，已保存的 Key 会保留。', actions: [{ label: '取消', value: false }, { label: '恢复', value: true, primary: true }] });
        if (!ok) return;
        const keys = { ...getSettings().keys };
        resetSettings();
        saveSettings({ keys });
        activeId = 'deepseek';
        renderTabs();
        renderPanel();
        ctx.updateStatusPill();
        toast('已恢复默认设置', 'ok');
      } }, '恢复默认设置'),
    ),
  );

  const explainer = h('div', { class: 'card settings-card' },
    h('h3', {}, h('span', { html: icon('lock', 18) }), '密钥与隐私'),
    h('div', { class: 'callout', style: 'margin-top:10px', html: `${icon('info', 16)}<span>EnOS 没有账号系统。Key 存在 localStorage，随每次请求发送到本机运行的 Node 服务，再由服务转发给对应厂商。关闭页面后不会上传到任何第三方服务器。</span>` }),
    h('div', { class: 'callout', style: 'margin-top:8px', html: `${icon('search', 16)}<span>联网搜索优先使用服务商能力：DeepSeek <code>/v1/tools/search</code>、Kimi <code>/v1/tools/search</code>、智谱 <code>/web_search</code>；无法使用时自动切换到维基百科与 DuckDuckGo。</span>` }),
    h('p', { class: 'small faint', style: 'margin-top:10px' }, '没有任何 Key 时，8 步任务与报告仍可完整使用：本地引擎会从 100 词库和场景模板生成内容。'),
  );

  el.append(
    h('div', { class: 'page-head' },
      h('p', { class: 'eyebrow' }, 'Settings'),
      h('h1', {}, '模型与语音'),
      h('p', { class: 'lede' }, '选择服务商，填入自己的 API Key。所有模型调用都从本机服务转发，Key 不会写进代码或日志。'),
    ),
    h('div', { class: 'settings-grid' },
      h('div', {},
        h('div', { class: 'card settings-card' },
          h('h3', {}, h('span', { html: icon('key', 18) }), '服务商'),
          h('p', { class: 'small muted', style: 'margin-top:6px' }, '四家都已适配 chat 与 search；自定义服务需兼容 OpenAI /chat/completions。'),
          tabs,
          panel,
        ),
        dataCard,
      ),
      h('div', {},
        explainer,
        h('div', { class: 'card settings-card' },
          h('h3', {}, h('span', { html: icon('bulb', 18) }), '没有 Key 怎么办'),
          h('p', { class: 'small muted', style: 'margin-top:8px' }, '直接回首页开始学习。本地引擎会：'),
          h('ul', { class: 'small muted', style: 'margin:8px 0 0 18px;padding:0;line-height:1.8' },
            h('li', {}, '从 100 个核心词中挑出与你输入最相关的 8 个'),
            h('li', {}, '生成 8 个不超过 5 分钟的任务与量化判定'),
            h('li', {}, '用浏览器语音朗读与识别完成跟读、对话'),
            h('li', {}, '输出可打印的独立学习报告'),
          ),
        ),
      ),
    ),
  );

  renderTabs();
  renderPanel();
  getHealth().then(() => { renderPanel(); });

  return { el, title: '设置 · EnOS' };
}
