import { Fragment, useState, type ReactNode } from "react";
import { ChevronDown, ChevronRight, Download, Image as ImageIcon, Trash2 } from "lucide-react";
import { downloadScreenCaptureImages, screenCaptureImageUrl, useDeleteScreenCaptureImages } from "../api/hooks";
import type { ScreenCaptureItem, ScreenCaptureReportRow, ScreenCaptureSourceKey } from "../api/types";
import EndpointLabel from "./EndpointLabel";
import { Alert, Badge, Button, IconButton, Modal, Pagination, Skeleton, Tag, useConfirm, usePagedList } from "./ui";
import { formatBytes, formatDateTime } from "../format";

// Screenshot report pieces shared by Data movement -> Screen capture (per policy) and the
// endpoint's Data protection tab (one endpoint, every policy): the per-user, per-day table and
// the screenshots behind a row. Images and their checkboxes only show for super admins (the
// server sends hasImage to them alone).

export const SOURCE_LABEL: Record<ScreenCaptureSourceKey, string> = {
  WINDOWS: "Windows",
  SNIPPING_TOOL: "Snipping Tool",
  GAME_BAR: "Game Bar",
  THIRD_PARTY: "ShareX",
  CUSTOM: "Custom folder",
};

function fileName(p: string): string {
  return p.split(/[\\/]/).pop() ?? p;
}

function ImageViewer({ capture, onClose, onDelete, deleting }: { capture: ScreenCaptureItem; onClose: () => void; onDelete: () => void; deleting: boolean }) {
  const [error, setError] = useState<string | null>(null);
  return (
    <Modal
      title={fileName(capture.filePath)}
      description={`${formatDateTime(capture.capturedAt)} · ${SOURCE_LABEL[capture.source] ?? capture.source}`}
      onClose={onClose}
      footer={
        <>
          <Button variant="danger" icon={Trash2} onClick={onDelete} disabled={deleting}>
            Delete image
          </Button>
          <Button icon={Download} onClick={() => downloadScreenCaptureImages([capture.id]).catch((e: Error) => setError(e.message))}>
            Download
          </Button>
          <Button variant="primary" onClick={onClose}>
            Close
          </Button>
        </>
      }
    >
      {error && <Alert tone="critical">{error}</Alert>}
      <img
        src={screenCaptureImageUrl(capture.id)}
        alt={`Screenshot ${fileName(capture.filePath)}`}
        style={{ maxWidth: "100%", maxHeight: "70vh", display: "block", margin: "0 auto", border: "1px solid var(--ep-border)", borderRadius: "var(--ep-radius-sm)" }}
      />
    </Modal>
  );
}

export function ScreenCaptureList({ captures, isLoading }: { captures: ScreenCaptureItem[] | undefined; isLoading: boolean }) {
  const deleteImages = useDeleteScreenCaptureImages();
  const confirm = useConfirm();
  const [selected, setSelected] = useState<string[]>([]);
  const [viewing, setViewing] = useState<ScreenCaptureItem | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  if (isLoading) return <Skeleton lines={3} />;
  if (!captures || captures.length === 0) return <span className="app-muted">No screenshots.</span>;

  // hasImage is only sent to super admins.
  const showImages = captures.some((c) => c.hasImage !== undefined);
  const withImage = captures.filter((c) => c.hasImage).map((c) => c.id);
  const target = selected.length > 0 ? selected : withImage;

  async function removeImages(ids: string[]) {
    const ok = await confirm({
      title: ids.length === 1 ? "Delete this screenshot image?" : `Delete ${ids.length} screenshot images?`,
      body: "The images are removed from the server. The screenshot records (time, user, file name) stay in the report. This cannot be undone.",
      confirmLabel: ids.length === 1 ? "Delete image" : "Delete images",
      tone: "danger",
    });
    if (!ok) return;
    deleteImages.mutate(ids, {
      onSuccess: () => {
        setSelected((sel) => sel.filter((id) => !ids.includes(id)));
        setViewing(null);
      },
    });
  }

  return (
    <div className="app-stack-sm">
      {showImages && withImage.length > 0 && (
        <div className="app-actions-row">
          <Button size="sm" icon={Download} onClick={() => downloadScreenCaptureImages(target).catch((e: Error) => setDownloadError(e.message))}>
            {selected.length > 0 ? `Download ${selected.length} selected` : `Download all ${withImage.length} images`}
          </Button>
          <Button size="sm" variant="danger" icon={Trash2} onClick={() => removeImages(target)} disabled={deleteImages.isPending}>
            {selected.length > 0 ? `Delete ${selected.length} selected` : `Delete all ${withImage.length} images`}
          </Button>
          <span className="app-muted">
            {withImage.length} of {captures.length} screenshots have a saved image.
          </span>
        </div>
      )}
      {downloadError && <Alert tone="critical">{downloadError}</Alert>}
      {deleteImages.error && <Alert tone="critical">{(deleteImages.error as Error).message}</Alert>}
      <table className="ep-tbl">
        <thead>
          <tr>
            {showImages && (
              <th scope="col">
                <span className="app-vh">Select</span>
              </th>
            )}
            {showImages && <th scope="col">Image</th>}
            <th scope="col">Taken</th>
            <th scope="col">File</th>
            <th scope="col">Tool</th>
            <th scope="col">Opened by</th>
            <th scope="col">Deleted</th>
          </tr>
        </thead>
        <tbody>
          {captures.map((c) => (
            <tr key={c.id}>
              {showImages && (
                <td className="ep-cb">
                  {c.hasImage && (
                    <input
                      type="checkbox"
                      aria-label={`Select ${fileName(c.filePath)}`}
                      checked={selected.includes(c.id)}
                      onChange={(e) => setSelected((sel) => (e.target.checked ? [...sel, c.id] : sel.filter((id) => id !== c.id)))}
                    />
                  )}
                </td>
              )}
              {showImages && (
                <td>
                  {c.hasImage ? (
                    <button
                      type="button"
                      onClick={() => setViewing(c)}
                      aria-label={`View screenshot ${fileName(c.filePath)}`}
                      title={`View · ${formatBytes(c.imageSizeBytes ?? null)}`}
                      style={{ padding: 0, border: "1px solid var(--ep-border)", borderRadius: "var(--ep-radius-sm)", background: "none", cursor: "zoom-in", lineHeight: 0 }}
                    >
                      <img src={screenCaptureImageUrl(c.id)} alt="" loading="lazy" style={{ width: 112, height: 63, objectFit: "cover", borderRadius: "var(--ep-radius-sm)" }} />
                    </button>
                  ) : (
                    <span className="app-muted" title="Not kept: images were off, a video, too large, or already deleted">
                      <ImageIcon size={16} strokeWidth={1.7} aria-hidden /> Not kept
                    </span>
                  )}
                </td>
              )}
              <td className="ep-num">{formatDateTime(c.capturedAt)}</td>
              <td className="ep-mono" title={c.filePath} style={{ overflowWrap: "anywhere" }}>
                {fileName(c.filePath)}
              </td>
              <td>{SOURCE_LABEL[c.source] ?? c.source}</td>
              <td>
                {c.openedBy.length > 0 ? (
                  <div className="app-badge-row">
                    {c.openedBy.map((o) => (
                      <span key={o.process} title={formatDateTime(o.at)}>
                        <Badge tone="med">{o.process}</Badge>
                      </span>
                    ))}
                  </div>
                ) : (
                  <span className="app-muted">—</span>
                )}
              </td>
              <td>
                {c.deletedAt ? (
                  c.quickDeleted ? (
                    <Badge tone="crit">{formatDateTime(c.deletedAt)}</Badge>
                  ) : (
                    formatDateTime(c.deletedAt)
                  )
                ) : (
                  <span className="app-muted">—</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {viewing && <ImageViewer capture={viewing} onClose={() => setViewing(null)} onDelete={() => removeImages([viewing.id])} deleting={deleteImages.isPending} />}
    </div>
  );
}

// One row per endpoint, user and day; the arrow opens that row's screenshots (renderCaptures).
export function ScreenCaptureDailyTable({
  rows,
  renderCaptures,
  showEndpoint = true,
}: {
  rows: ScreenCaptureReportRow[];
  renderCaptures: (row: ScreenCaptureReportRow) => ReactNode;
  showEndpoint?: boolean;
}) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const paged = usePagedList(rows, 25);
  return (
        <div className="app-table-wrap">
          <table className="ep-tbl">
            <thead>
              <tr>
                <th scope="col">
                  <span className="app-vh">Expand</span>
                </th>
                <th scope="col">Date</th>
                {showEndpoint && <th scope="col">Endpoint</th>}
                <th scope="col">User</th>
                <th scope="col" style={{ textAlign: "right" }}>
                  Screenshots
                </th>
                <th scope="col" style={{ textAlign: "right" }}>
                  Deleted quickly
                </th>
                <th scope="col">Opened by</th>
                <th scope="col">Tools</th>
              </tr>
            </thead>
            <tbody>
              {paged.pageItems.map((r) => {
                const key = `${r.agentId}|${r.username}|${r.day}`;
                const isOpen = expanded === key;
                return (
                  <Fragment key={key}>
                    <tr>
                      <td className="ep-cb">
                        <IconButton
                          icon={isOpen ? ChevronDown : ChevronRight}
                          label={isOpen ? `Hide screenshots of ${r.username}` : `Show screenshots of ${r.username}`}
                          onClick={() => setExpanded(isOpen ? null : key)}
                        />
                      </td>
                      <td className="ep-num">{r.day}</td>
                      {showEndpoint && (
                        <td>
                          <EndpointLabel hostname={r.hostname} agentId={r.agentId} />
                        </td>
                      )}
                      <td>{r.username}</td>
                      <td className="ep-num" style={{ textAlign: "right" }}>
                        {r.overThreshold ? <Badge tone="crit">{r.count}</Badge> : r.count}
                      </td>
                      <td className="ep-num" style={{ textAlign: "right" }}>
                        {r.quickDeleted > 0 ? <Badge tone="med">{r.quickDeleted}</Badge> : <span className="app-muted">—</span>}
                      </td>
                      <td>
                        {r.openedBy.length > 0 ? (
                          <div className="app-badge-row">
                            {r.openedBy.map((p) => (
                              <Tag key={p}>{p}</Tag>
                            ))}
                          </div>
                        ) : (
                          <span className="app-muted">—</span>
                        )}
                      </td>
                      <td>{r.sources.map((s) => SOURCE_LABEL[s] ?? s).join(", ")}</td>
                    </tr>
                    {isOpen && (
                      <tr>
                        <td colSpan={showEndpoint ? 8 : 7} style={{ background: "var(--ep-surface-2)" }}>
                          {renderCaptures(r)}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
          <Pagination
            page={paged.page}
            pageSize={paged.pageSize}
            total={paged.total}
            noun="rows"
            onPageChange={paged.setPage}
            onPageSizeChange={paged.setPageSize}
          />
        </div>
  );
}
