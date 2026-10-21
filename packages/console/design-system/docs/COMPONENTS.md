# Meridian — component contract

Every component below is styled by `css/meridian.css` and needs `tokens/tokens.css` loaded first. **The class names and nesting are the contract**: reproduce them exactly, whether you write plain HTML or build framework components that render this markup. The rendered versions are in `reference/components.html`.

Conventions:

- All classes start with `ep-`, and all variables with `--ep-`. Legacy CSS can stay loaded during migration without clashing.
- The page root must have `class="ep-app"`. Box-sizing, the reset and focus rings are scoped to it.
- State modifiers are separate classes: `ep-on` (active or selected), `ep-sel` (selected row), `ep-invalid`, `ep-disabled`.
- `<i data-lucide="name"></i>` below stands for a 16px Lucide icon. Render it however your framework does (for example `<Monitor size={16} strokeWidth={1.7} />`), and **give it the class `ep-ic`**.
- Use real `<button>` for actions and `<a>` for navigation. The classes work on `div`, `a` and `button`.

---

## 1. App shell

```html
<body>
  <div class="ep-app">
    <aside class="ep-sb"> … sidebar (§2) … </aside>
    <main class="ep-main">
      <header class="ep-tb"> … top bar (§3) … </header>
      <div class="ep-pg"> … page header (§4) + page content … </div>
    </main>
  </div>
</body>
```

`.ep-app` is a CSS grid: a 248px sidebar plus fluid content. `.ep-pg` has 24px padding and a 16px vertical gap, so don't add margins between sections.

## 2. Sidebar

```html
<aside class="ep-sb">
  <div class="ep-brandrow">
    <!-- logo: 28px tile, radius 7px, fill var(--ep-brand), white shield-check mark -->
    <svg width="28" height="28" viewBox="0 0 28 28" aria-hidden="true">…</svg>
    <div><b>Endpoint IQ</b></div>
  </div>

  <div class="ep-ov">Operations</div>
  <a class="ep-ni ep-on" href="/dashboard"><i data-lucide="layout-grid" class="ep-ic"></i><span>Dashboard</span></a>

  <!-- collapsed module -->
  <a class="ep-ni" href="#"><i data-lucide="monitor" class="ep-ic"></i><span>Endpoint Manager</span><i data-lucide="chevron-right" class="ep-ic ep-chev"></i></a>

  <!-- expanded module: chevron-down + .ep-sub list; the current sub-page gets ep-on-sub -->
  <a class="ep-ni" href="#"><i data-lucide="shield" class="ep-ic"></i><span>Security Manager</span><i data-lucide="chevron-down" class="ep-ic ep-chev"></i></a>
  <div class="ep-sub">
    <a class="ep-cnt ep-on-sub" href="/security/vulnerabilities"><span>Vulnerabilities</span><span class="ep-num">74</span></a>
    <a href="/security/patches">Patches</a>
    <a href="/security/configuration">Security configuration</a>
    <a href="/security/zero-trust">Zero Trust</a>
  </div>

  <div class="ep-ov">Administration</div>
  <a class="ep-ni" href="/licensing"><i data-lucide="key-round" class="ep-ic"></i><span>Licensing</span></a>
  <a class="ep-ni" href="/administrators"><i data-lucide="settings" class="ep-ic"></i><span>Administrators</span></a>

  <div class="ep-sbfoot">
    <div class="ep-av">CI</div>
    <div><b>CIO Office</b><small>admin@example.com</small></div>
  </div>
</aside>
```

- The active top-level item gets `ep-on`, which shows a pink tint and the 3px brand bar on its left edge.
- When a sub-page is active, its parent module stays expanded but **does not** get `ep-on`; only the sub-item gets `ep-on-sub`.
- Add `ep-cnt` to sub-items that show a count. Only show counts that need action, such as open vulnerabilities.
- Expand only one module at a time.

## 3. Top bar

```html
<header class="ep-tb">
  <nav class="ep-crumb" aria-label="Breadcrumb">Endpoint Manager <i data-lucide="chevron-right" class="ep-ic"></i> <b>Endpoints</b></nav>
  <div class="ep-search" role="search"><i data-lucide="search" class="ep-ic"></i><span>Search endpoints, IPs, CVEs, users…</span><span class="ep-kbd">Ctrl K</span></div>
  <div class="ep-tbr">
    <button class="ep-btn"><i data-lucide="calendar" class="ep-ic"></i>Last 24 hours<i data-lucide="chevron-down" class="ep-ic"></i></button>
    <button class="ep-iconbtn" aria-label="Notifications"><i data-lucide="bell" class="ep-ic"></i><span class="ep-dot"></span></button>
    <div class="ep-tenant"><div class="ep-av" style="width:28px;height:28px">CI</div><i data-lucide="chevron-down" class="ep-ic"></i></div>
  </div>
</header>
```

- The breadcrumb's last item is bold and isn't a link.
- `.ep-search` opens the global search or command palette. If the app has no global search yet, keep the field and wire it to endpoint search.
- Show the time-range picker only on pages that have time-based data.
- Show `.ep-dot` on the bell only when there are unread alerts.

## 4. Page header and tabs

```html
<div class="ep-ph">
  <div>
    <h1>Endpoints</h1>
    <p>All devices with the Endpoint IQ agent installed</p>
    <!-- live pages: <p><span class="ep-live">Live</span>· 292 managed endpoints · Updated 2 min ago</p> -->
  </div>
  <div class="ep-acts">
    <button class="ep-btn"><i data-lucide="download" class="ep-ic"></i>Export CSV</button>
    <button class="ep-btn ep-btn-primary"><i data-lucide="key-round" class="ep-ic"></i>Enroll endpoint</button>
  </div>
</div>

<nav class="ep-tabs">               <!-- optional: sub-views of the same object -->
  <a class="ep-on" href="#">Overview</a>
  <a href="#">Vulnerabilities</a>
  <a href="#">Network coverage</a>
</nav>
```

Allow one `h1` per page and at most one primary button. Secondary actions go to its left.

## 5. Buttons

| Variant | Markup | When |
|---|---|---|
| Primary | `<button class="ep-btn ep-btn-primary">` (alias `ep-btn ep-pri`) | The single main action of the view |
| Secondary | `<button class="ep-btn">` | Other actions |
| Ghost | `<button class="ep-btn ep-btn-ghost">` | Cancel, low emphasis |
| Danger outline | `<button class="ep-btn ep-btn-danger">` | A destructive action shown in a list or toolbar |
| Danger solid | `<button class="ep-btn ep-btn-danger-solid">` | The confirm button inside a destructive modal only |
| Small | add `ep-btn-sm` (30px) | Inside card headers, toolbars, bulk bars |
| Icon only | `<button class="ep-iconbtn" aria-label="…">` | Top bar, row actions |
| Text link | `<a class="ep-link">View all</a>` | "View all", "Show all", inline navigation |

Icons are 15px inside buttons and come before the label. Disabled buttons use the `disabled` attribute (or `ep-disabled` on links).

## 6. Status: badges, pills, tags, deltas

```html
<!-- severity / result -->
<span class="ep-badge ep-b-crit">Critical</span>
<span class="ep-badge ep-b-high">High</span>
<span class="ep-badge ep-b-med">Medium</span>
<span class="ep-badge ep-b-low">Low</span>
<span class="ep-badge ep-b-ok">Compliant</span>
<span class="ep-badge ep-b-neu">Not assessed</span>

<!-- live state: dot colour via --ep-c -->
<span class="ep-pill" style="--ep-c:var(--ep-ok)">Online</span>
<span class="ep-pill" style="--ep-c:var(--ep-neutral)">Offline</span>
<span class="ep-pill" style="--ep-c:var(--ep-warn-fill)">Unmanaged</span>

<!-- user-defined labels -->
<span class="ep-tag">Finance</span>

<!-- trend chip in KPI footers: colour = good/bad, not up/down -->
<span class="ep-delta ep-up-bad"><i data-lucide="chevron-up" class="ep-ic"></i>9</span>
<span class="ep-delta ep-up-good"><i data-lucide="chevron-up" class="ep-ic"></i>6</span>
<span class="ep-delta ep-warn">276 not assessed</span>
```

Map backend values in one place, such as a `statusBadge(value)` helper. Don't repeat the mapping in templates:

| Backend value | Component |
|---|---|
| critical / high / medium / low | `ep-badge ep-b-crit / -high / -med / -low` |
| clean, compliant, trusted, patched | `ep-badge ep-b-ok` |
| not assessed, unknown, n/a | `ep-badge ep-b-neu` |
| online | `ep-pill` + `--ep-ok` |
| offline | `ep-pill` + `--ep-neutral` |
| unmanaged, pending, warning | `ep-pill` + `--ep-warn-fill` |
| not trusted, failed, blocked | `ep-pill` + `--ep-sev-critical` |

## 7. Card

```html
<section class="ep-card">
  <div class="ep-ch">
    <h3>Agent coverage by VLAN</h3>
    <span class="ep-hint">· managed vs. unenrolled hosts from latest scan</span>
    <div class="ep-r"><a class="ep-link">View all</a></div>   <!-- right side: link, legend, badge or small buttons -->
  </div>
  <div class="ep-cb"> … body … </div>
</section>
```

For a card that wraps a full-bleed table, use `<section class="ep-card" style="overflow:hidden">`, put `padding-bottom:14px` on `.ep-ch`, and place the table directly after it, outside `.ep-cb`.

## 8. KPI tiles

```html
<div class="ep-kpis">                      <!-- 5 columns; 3 at ≤1280px -->
  <div class="ep-card ep-kpi">
    <div class="ep-lb"><i data-lucide="monitor" class="ep-ic"></i>Total endpoints</div>
    <div class="ep-v">292<small>managed</small></div>
    <div class="ep-ft"><span class="ep-delta ep-up-good"><i data-lucide="chevron-up" class="ep-ic"></i>6</span> enrolled this week</div>
  </div>
  <div class="ep-card ep-kpi">
    <div class="ep-lb"><i data-lucide="radar" class="ep-ic"></i>Online now</div>
    <div class="ep-v">209<small>72%</small></div>
    <div class="ep-kbar"><i style="width:72%;background:var(--ep-ok)"></i><i style="width:28%;background:var(--ep-neutral)"></i></div>
  </div>
  <div class="ep-card ep-kpi">
    <div class="ep-lb"><i data-lucide="triangle-alert" class="ep-ic"></i>With vulnerabilities</div>
    <div class="ep-v"><span style="color:var(--ep-sev-critical)">74</span><small>25%</small></div>
    <div class="ep-ft"><span class="ep-delta ep-up-bad"><i data-lucide="chevron-up" class="ep-ic"></i>9</span> since yesterday</div>
  </div>
</div>
```

Colour the value only for risk counts (`--ep-sev-critical`) and warnings (`--ep-sev-medium`). A KPI tile that links somewhere should be wrapped in an `<a>` that goes to the filtered list.

## 9. Coverage table (stacked bars)

```html
<table class="ep-cov">
  <thead><tr><th>Network</th><th>Coverage</th><th style="text-align:right">Managed</th><th style="text-align:right">%</th></tr></thead>
  <tbody>
    <tr>
      <td class="ep-n" style="width:190px">VLAN 6<small>149 hosts</small></td>
      <td><div class="ep-sbar"><i style="width:27.5%;background:var(--ep-ok)"></i><i style="width:72.5%;background:var(--ep-warn-fill)"></i></div></td>
      <td class="ep-t" style="width:80px">41 / 149</td>
      <td class="ep-p" style="color:var(--ep-sev-medium)">28%</td>  <!-- ≥50%: var(--ep-ok); <50%: var(--ep-sev-medium) -->
    </tr>
    <tr>  <!-- no data -->
      <td class="ep-n">VLAN 7<small>not scanned</small></td>
      <td><span class="ep-nodata">No scan data yet — schedule a network scan</span></td>
      <td class="ep-t">—</td><td class="ep-p" style="color:var(--ep-ink-subtle)">—</td>
    </tr>
  </tbody>
</table>
```

Sort rows by host count, largest first. Bar widths are percentages computed in code. If two networks share a name, show the subnet in the `<small>` line.

## 10. Donut with legend (2–3 part ratios only)

```html
<div class="ep-dn">
  <svg width="128" height="128" viewBox="0 0 128 128">
    <!-- track -->
    <circle cx="64" cy="64" r="57" fill="none" style="stroke:var(--ep-surface-2)" stroke-width="14"/>
    <!-- one circle per segment: stroke-dasharray = "<len-2> <circumference>", dashoffset = -<start>, rotate(-90) -->
    <text x="50%" y="66" text-anchor="middle" style="fill:var(--ep-ink);font:600 24px var(--ep-font-sans)">292</text>
    <text x="50%" y="84" text-anchor="middle" style="fill:var(--ep-ink-subtle);font:500 11px var(--ep-font-sans)">endpoints</text>
  </svg>
  <div class="ep-lg">
    <div><i class="ep-sw" style="background:var(--ep-ok)"></i>Clean<b>218</b><em>75%</em></div>
    <div><i class="ep-sw" style="background:var(--ep-sev-critical)"></i>Vulnerable<b>74</b><em>25%</em></div>
  </div>
</div>
```

You can use a chart library instead (see DESIGN_SYSTEM.md §6) if it renders the same thing: 14px ring, 2px gap between segments, centre total, and an HTML legend with count and %.

## 11. Ranked bars (categories)

```html
<div class="ep-bl">
  <div class="ep-it">
    <span class="ep-k">Laptop</span>
    <span class="ep-vv"><b>164</b> · 56%</span>
    <div class="ep-track"><i style="width:56%;background:var(--ep-chart-1)"></i></div>
  </div>
  …
</div>
```

Sort largest first. Show at most 5 rows, then add a line: `+3 more · <a class="ep-link">Show all</a>`. Put the long-tail or unknown bucket last, in `--ep-neutral`, and flag it with an `ep-badge ep-b-med` in the card header.

## 12. Legend (for bars and stacked bars)

```html
<div class="ep-legend">
  <span><i class="ep-sw" style="background:var(--ep-ok)"></i>Managed</span>
  <span><i class="ep-sw" style="background:var(--ep-warn-fill)"></i>Unmanaged</span>
</div>
```

## 13. Data table (with toolbar, bulk bar, pagination)

```html
<section class="ep-card" style="overflow:hidden">
  <div class="ep-toolbar">
    <div class="ep-input-icon"><i data-lucide="search" class="ep-ic"></i><input class="ep-input" placeholder="Search hostname, IP, user…"></div>
    <select class="ep-select"><option>Status: All</option></select>
    <select class="ep-select"><option>OS: All</option></select>
    <div class="ep-r">
      <div class="ep-seg"><button class="ep-on">All 292</button><button>Online 209</button><button>Offline 83</button></div>
      <button class="ep-btn ep-btn-sm"><i data-lucide="settings" class="ep-ic"></i>Columns</button>
    </div>
  </div>

  <!-- only when ≥1 row is selected -->
  <div class="ep-bulk"><b>2 selected</b>
    <button class="ep-btn ep-btn-sm">Deploy package</button>
    <button class="ep-btn ep-btn-sm ep-btn-danger">Remove agent</button>
    <a class="ep-link" style="margin-left:auto">Clear selection</a>
  </div>

  <table class="ep-tbl">
    <thead><tr>
      <th class="ep-cb" scope="col"><input type="checkbox" aria-label="Select all"></th>
      <th class="ep-sort" scope="col">Endpoint</th><th scope="col">Operating system</th><th scope="col">Status</th>
      <th scope="col">Top severity</th><th scope="col">Last seen</th><th scope="col"></th>
    </tr></thead>
    <tbody>
      <tr class="ep-sel">
        <td class="ep-cb"><input type="checkbox" checked aria-label="Select SXG-LT-0142"></td>
        <td class="ep-host"><b>SXG-LT-0142</b><small>10.20.6.114</small></td>
        <td>Windows 10 Pro</td>
        <td><span class="ep-pill" style="--ep-c:var(--ep-ok)">Online</span></td>
        <td><span class="ep-badge ep-b-crit">Critical</span></td>
        <td style="color:var(--ep-ink-subtle)">2 min ago</td>
        <td style="text-align:right"><button class="ep-iconbtn" aria-label="Actions for SXG-LT-0142"><i data-lucide="ellipsis" class="ep-ic"></i></button></td>
      </tr>
    </tbody>
  </table>

  <div class="ep-pagination">Showing <b>1–25</b> of 292 endpoints
    <select class="ep-select" style="width:auto;height:30px;margin-left:8px"><option>25 per page</option></select>
    <div class="ep-r">
      <button class="ep-page-btn" aria-label="Previous page"><i data-lucide="chevron-left" class="ep-ic"></i></button>
      <button class="ep-page-btn ep-on" aria-current="page">1</button><button class="ep-page-btn">2</button>
      <button class="ep-page-btn" aria-label="Next page"><i data-lucide="chevron-right" class="ep-ic"></i></button>
    </div>
  </div>
</section>
```

Column order:

1. Checkbox.
2. The identity column: hostname or name in `<b>`, with the IP or ID underneath in `<small>`.
3. Descriptive columns.
4. Status, then severity.
5. Time.
6. The row actions menu.

Put numbers in tabular figures, right-aligned when they're quantities. Put versions and IPs in `ep-mono`. Rows highlight on hover. The whole row (except the checkbox and menu) opens the detail page.

## 14. Forms

```html
<form class="ep-card">
  <div class="ep-section">
    <h4>Token details</h4>
    <p>Name the token after where it will be used, so it is easy to revoke later.</p>
    <div class="ep-form-grid">                                   <!-- 2 columns; use ep-span2 for full width -->
      <div class="ep-field ep-span2">
        <label class="ep-label" for="name">Token name<span class="ep-req">*</span></label>
        <input class="ep-input" id="name" name="name">
      </div>
      <div class="ep-field">
        <label class="ep-label" for="expires">Expires</label>
        <select class="ep-select" id="expires"><option>In 7 days</option></select>
        <span class="ep-help">Expired tokens stop new enrollments.</span>
      </div>
      <div class="ep-field">
        <label class="ep-label" for="uses">Maximum uses</label>
        <input class="ep-input ep-invalid" id="uses" aria-invalid="true" aria-describedby="uses-err">
        <span class="ep-error" id="uses-err"><i data-lucide="triangle-alert" class="ep-ic"></i>Enter a number between 1 and 1,000.</span>
      </div>
      <div class="ep-field ep-span2">
        <label class="ep-label" for="desc">Description</label>
        <textarea class="ep-textarea" id="desc"></textarea>
      </div>
    </div>
  </div>
  <div class="ep-section">
    <h4>Options</h4><p>Applied to every endpoint enrolled with this token.</p>
    <label class="ep-switch ep-on"><input type="checkbox" hidden checked><i></i>Approve endpoints automatically</label>
    <label class="ep-check"><input type="checkbox"><span>Run a vulnerability scan after enrollment<small>Results appear under Vulnerabilities.</small></span></label>
  </div>
  <div class="ep-formfoot"><button type="button" class="ep-btn">Cancel</button><button type="submit" class="ep-btn ep-btn-primary">Create token</button></div>
</form>
```

- Toggle `ep-on` on `.ep-switch` from the hidden checkbox's state. Keep the real `<input>` for form submission.
- Validate on blur and on submit. Show `.ep-error` under the field, and keep the existing validation logic.
- Field widths come from the grid. Don't set pixel widths on inputs.

## 15. Alerts, toast, empty and loading

```html
<div class="ep-alert ep-alert-warn"><i data-lucide="triangle-alert" class="ep-ic"></i><div><b>195 unmanaged devices</b>Hosts seen on the network without an agent.</div></div>
<!-- variants: ep-alert-info · ep-alert-warn · ep-alert-critical · ep-alert-success -->

<div class="ep-toast" role="status"><i data-lucide="check" class="ep-ic"></i>Token copied to clipboard</div>
<!-- toasts: bottom-right, 16px from edges, auto-dismiss after 4 s, never for errors that need action -->

<div class="ep-empty">
  <div class="ep-eic"><i data-lucide="radar" class="ep-ic"></i></div>
  <b>No scan data for VLAN 7</b>
  Run a network scan to see which hosts have the agent.
  <button class="ep-btn ep-btn-primary ep-btn-sm">Schedule scan</button>
</div>

<span class="ep-skel" style="width:40%"></span>   <!-- skeleton line; stack 3–4 inside .ep-cb while loading -->
```

## 16. Menu and modal

```html
<div class="ep-menu" role="menu">
  <button role="menuitem"><i data-lucide="monitor" class="ep-ic"></i>View details</button>
  <button role="menuitem"><i data-lucide="radar" class="ep-ic"></i>Run scan</button>
  <hr>
  <button role="menuitem" class="ep-danger">Remove agent</button>
</div>

<!-- modal: render the backdrop as a fixed overlay; .ep-modal-wrap is only the gallery's static frame -->
<div class="ep-modal" role="dialog" aria-modal="true" aria-labelledby="m-title">
  <header><div><h3 id="m-title">Remove agent from 2 endpoints?</h3>
    <p>SXG-LT-0142 and SXG-LT-0209 will stop reporting and lose their policies. You can re-enroll them later.</p></div></header>
  <div class="ep-mb"><label class="ep-check"><input type="checkbox">Also uninstall the agent software</label></div>
  <footer><button class="ep-btn">Cancel</button><button class="ep-btn ep-btn-danger-solid">Remove agent</button></footer>
</div>
```

The modal backdrop is `position:fixed; inset:0; background:color-mix(in srgb,var(--ep-ink) 40%,transparent); display:grid; place-items:center`. Esc and a backdrop click close it, and focus is trapped inside while it's open.

## 17. Detail page bits

```html
<dl class="ep-kv"><dt>Hostname</dt><dd class="ep-mono">SXG-LT-0142</dd><dt>Group</dt><dd>Hallmark 12th Floor</dd></dl>
<div class="ep-code">msiexec /i EndpointPro.msi /quiet TOKEN=ept_8f2c…41ad<button class="ep-btn ep-btn-sm">Copy</button></div>
```

## 18. Icons (Lucide names)

| Use | Lucide icon |
|---|---|
| Dashboard | `layout-grid` |
| Endpoint Manager / endpoint | `monitor` |
| Network Manager | `network` |
| Software Manager / package | `package` |
| Security Manager | `shield` |
| Zero Trust / trusted | `shield-check` |
| Vulnerability / warning | `triangle-alert` |
| Data Manager | `database` |
| User Manager | `users` |
| Licensing / enrollment token | `key-round` |
| Administrators / settings / columns | `settings` |
| Network scan / online | `radar` |
| Search | `search` |
| Notifications | `bell` |
| Time range | `calendar` |
| Export / download | `download` |
| Filter | `filter` |
| Row actions | `ellipsis` |
| Expand / collapse / next | `chevron-down` / `chevron-right` |

Size is 16px in navigation and lists, 15px in buttons and 14px in KPI labels. Stroke width is 1.7 and colour is `currentColor`.
