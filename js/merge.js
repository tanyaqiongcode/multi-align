'use strict';
/* 多语平行语料对齐工作台 —— 多版本合并（基准语枢纽 + 连通分量）
 * 每个非基准版本独立与基准语对齐，再以“句子”为节点、对齐句对为边做并查集，
 * 连通分量即翻译单元（TU）：一个 TU 内含各版本的一句或多句。
 */
PA.Merge = (function () {
  const Seg = PA.Seg;

  function buildTUs(versions, pivotId, segs, pairResults) {
    const pivotPos = Math.max(0, versions.findIndex(v => v.id === pivotId));
    const posOf = {};
    versions.forEach((v, i) => { posOf[v.id] = i; });
    const key = (vi, si) => vi * 1000000 + si;

    /* 并查集 */
    const parent = new Map();
    function find(x) {
      let r = x;
      while (parent.get(r) !== r) r = parent.get(r);
      let c = x;
      while (c !== r) { const nx = parent.get(c); parent.set(c, r); c = nx; }
      return r;
    }
    function union(a, b) {
      const ra = find(a), rb = find(b);
      if (ra === rb) return;
      parent.set(ra, rb);
    }

    versions.forEach((v, vi) => {
      const arr = segs[v.id] || [];
      for (let si = 0; si < arr.length; si++) {
        const k = key(vi, si);
        if (!parent.has(k)) parent.set(k, k);
      }
    });

    pairResults.forEach(pr => {
      const vi = posOf[pr.vid];
      if (vi === undefined) return;
      pr.beads.forEach(b => {
        b.a.forEach(ai => b.b.forEach(bi => union(key(pivotPos, ai), key(vi, bi))));
      });
    });

    /* 连通分量 → {vi: [si...]} */
    const comps = new Map();
    versions.forEach((v, vi) => {
      const arr = segs[v.id] || [];
      for (let si = 0; si < arr.length; si++) {
        const r = find(key(vi, si));
        let c = comps.get(r);
        if (!c) { c = {}; comps.set(r, c); }
        (c[vi] = c[vi] || []).push(si);
      }
    });

    /* 每个分量所含句对的置信度——取各版本最低值（min）。
     * 语义：一行是否需要审校，取决于对得最差的那个版本（平均会稀释单版本
     * 的 1-2/删除告警，见交叉审计发现：0.72 的污染被平均成 0.84）。 */
    const confAgg = new Map();
    pairResults.forEach(pr => {
      pr.beads.forEach(b => {
        if (!b.a.length || !b.b.length) return;
        const r = find(key(pivotPos, b.a[0]));
        const g = confAgg.get(r);
        if (!g || b.conf < g.m) confAgg.set(r, { m: b.conf });
      });
    });

    /* 各版本句子→基准句映射（用于为不含基准句的分量估算顺序） */
    const pivotMaps = {};
    pairResults.forEach(pr => {
      const vi = posOf[pr.vid];
      if (vi === undefined) return;
      const mp = new Array((segs[pr.vid] || []).length);
      pr.beads.forEach(b => {
        b.a.forEach(ai => b.b.forEach(bi => {
          if (mp[bi] === undefined || ai < mp[bi]) mp[bi] = ai;
        }));
      });
      pivotMaps[vi] = mp;
    });

    const nPivot = (segs[pivotId] || []).length;
    let fallbackCtr = 0;

    const ordered = Array.from(comps.entries()).map(entry => {
      const root = entry[0], comp = entry[1];
      let ord;
      if (comp[pivotPos] && comp[pivotPos].length) {
        ord = Math.min.apply(null, comp[pivotPos]);
      } else {
        let best = Infinity;
        versions.forEach((v, vi) => {
          const idxs = comp[vi] || [];
          const mp = pivotMaps[vi];
          if (!mp) return;
          idxs.forEach(si => {
            let pv = null, nx = null;
            for (let k = si - 1; k >= 0; k--) { if (mp[k] !== undefined) { pv = mp[k]; break; } }
            for (let k = si + 1; k < mp.length; k++) { if (mp[k] !== undefined) { nx = mp[k]; break; } }
            let e = null;
            if (pv !== null && nx !== null) e = (pv + nx) / 2;
            else if (pv !== null) e = pv + 0.5;
            else if (nx !== null) e = nx - 0.5;
            if (e !== null && e < best) best = e;
          });
        });
        ord = best === Infinity ? nPivot + (fallbackCtr++) : best;
      }
      const g = confAgg.get(root);
      return { comp: comp, ord: ord, conf: g ? g.m : 0.2 };
    }).sort((x, y) => x.ord - y.ord);

    /* 生成 TU */
    const tus = [];
    ordered.forEach(item => {
      const comp = item.comp;
      const cells = {};
      versions.forEach((v, vi) => {
        const idxs = comp[vi];
        if (idxs && idxs.length) {
          const arr = segs[v.id];
          const sep = idxs.length > 1 && !Seg.isCJKText(idxs.map(si => arr[si].text).join('')) ? ' ' : '';
          cells[v.id] = idxs.map(si => arr[si].text).join(sep);
        } else {
          cells[v.id] = '';
        }
      });
      tus.push({
        cells: cells,
        conf: Math.round(item.conf * 100) / 100,
        locked: false,
        modified: false,
        srcIdx: (comp[pivotPos] || []).slice()  // 基准语句子下标（句序溯源，见导出与编辑器提示）
      });
    });
    return tus;
  }

  return { buildTUs };
})();
