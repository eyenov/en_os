import { deleteSession, listSessions } from '../store.js';
import { getScene } from '../scenes.js';
import { formatDate, h, icon, modal, toast } from '../ui.js';

export function renderReports(ctx) {
  const sessions = listSessions();
  const el = h('div', {});
  const totalSeconds = sessions.reduce((sum, session) => sum + (session.summary?.totalSeconds || 0), 0);
  const totalMinutes = totalSeconds >= 60 ? Math.round(totalSeconds / 60) : totalSeconds ? '<1' : 0;
  const average = sessions.length
    ? Math.round(sessions.reduce((sum, session) => sum + (session.summary?.overall || 0), 0) / sessions.length)
    : 0;

  const list = h('div', { class: 'report-list' });
  if (!sessions.length) {
    list.append(h('div', { class: 'empty-note' },
      h('p', {}, '还没有完成的学习报告。'),
      h('p', { class: 'small', style: 'margin-top:8px' }, '走完 8 步后，这里会自动生成一份可打印的报告。'),
      h('a', { class: 'btn btn-primary btn-sm', href: '#/home', style: 'margin-top:14px' }, '开始第一份'),
    ));
  }

  for (const session of sessions) {
    const scene = getScene(session.sceneId);
    const summary = session.summary || {};
    const title = String(session.input?.text || '未命名学习').replace(/\s+/g, ' ').slice(0, 90);
    const row = h('div', {
      class: 'report-row',
      role: 'link',
      tabindex: '0',
      onclick: () => { window.location.href = `/report.html?id=${encodeURIComponent(session.id)}`; },
      onkeydown: (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); window.location.href = `/report.html?id=${encodeURIComponent(session.id)}`; } },
    },
      h('div', { class: 'rr-main' },
        h('div', { class: 'rr-title' }, title),
        h('div', { class: 'rr-meta' }, `${scene.name}场景 · ${formatDate(session.finishedAt || session.createdAt)} · ${summary.completedSteps ?? 0}/8 步 · Band ${summary.band ?? '—'}`),
      ),
      h('div', { class: 'rr-stats' },
        h('div', { class: 'rr-stat' }, h('strong', {}, String(summary.overall ?? '—')), h('span', {}, 'score')),
        h('div', { class: 'rr-stat' }, h('strong', {}, String(summary.totalSeconds ? Math.max(1, Math.round(summary.totalSeconds / 60)) : 0)), h('span', {}, 'min')),
      ),
      h('button', {
        class: 'icon-btn',
        type: 'button',
        'aria-label': '删除这份报告',
        onclick: async (event) => {
          event.preventDefault();
          event.stopPropagation();
          const ok = await modal({ title: '删除这份报告？', body: '只删除这台设备上的记录，无法恢复。', actions: [{ label: '取消', value: false }, { label: '删除', value: true, primary: true }] });
          if (!ok) return;
          deleteSession(session.id);
          toast('已删除', 'ok', 1800);
          window.dispatchEvent(new HashChangeEvent('hashchange'));
        },
      }, h('span', { html: icon('trash', 16) })),
    );
    list.append(row);
  }

  el.append(
    h('div', { class: 'page-head' },
      h('p', { class: 'eyebrow' }, 'Reports'),
      h('h1', {}, '学习报告'),
      h('p', { class: 'lede' }, '每一份报告都包含原始输入、目标、词汇与语法清单，以及听力、阅读、口语、写作四项的证据与得分。'),
    ),
    sessions.length
      ? h('div', { class: 'hero-meta', style: 'margin-bottom:18px' },
        h('span', { class: 'chip' }, `共 ${sessions.length} 份`),
        h('span', { class: 'chip' }, `累计 ${totalMinutes} 分钟`),
        h('span', { class: 'chip' }, `平均 ${average} 分`),
      )
      : null,
    list,
    h('div', { class: 'report-foot', style: 'margin-top:20px' },
      h('span', {}, '报告保存在浏览器 localStorage，最多保留 8 份。'),
      h('a', { class: 'link-btn', href: '#/settings' }, '管理本机数据 →'),
    ),
  );

  return { el, title: '学习报告 · EnOS' };
}
