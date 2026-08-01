// FileOps.cpp — Minifilter pre/post callbacks for file I/O
#include <fltKernel.h>
#include "../../common/DLPProtocol.h"

extern PFLT_FILTER  g_Filter;
extern PFLT_PORT    g_ClientPort;
extern PEPROCESS    g_ServiceProcess;

// ---- Helpers ------------------------------------------------------------

// Kernel-safe ASCII-range lowercase (handles drive letters and path separators).
static wchar_t KlLower(wchar_t c)
{
    return (c >= L'A' && c <= L'Z') ? (wchar_t)(c + (L'a' - L'A')) : c;
}

// Case-insensitive substring search. lowerSub must already be lowercase.
static BOOLEAN PathContains(const wchar_t* path, const wchar_t* lowerSub)
{
    SIZE_T pLen = 0; while (path[pLen])    pLen++;
    SIZE_T sLen = 0; while (lowerSub[sLen]) sLen++;
    if (pLen < sLen) return FALSE;
    for (SIZE_T i = 0; i <= pLen - sLen; i++) {
        BOOLEAN ok = TRUE;
        for (SIZE_T j = 0; j < sLen && ok; j++)
            ok = (KlLower(path[i + j]) == lowerSub[j]);
        if (ok) return TRUE;
    }
    return FALSE;
}

// Returns TRUE for high-frequency system paths that never hold user-generated
// sensitive content — skipping them eliminates most of the agent queue load.
static BOOLEAN IsSystemPath(const wchar_t* path)
{
    static const wchar_t* kSkip[] = {
        L"\\windows\\",
        L"\\program files\\",
        L"\\program files (x86)\\",
        L"\\programdata\\microsoft\\windows\\",
        L"\\programdata\\microsoft\\windows defender\\",
        NULL
    };
    for (int i = 0; kSkip[i]; i++)
        if (PathContains(path, kSkip[i])) return TRUE;
    return FALSE;
}

// Fill DLP_MSG_HEADER from live callback data.
static VOID FillHeader(DLP_MSG_HEADER*      hdr,
                        ULONG                msgType,
                        PFLT_CALLBACK_DATA   Data,
                        PCFLT_RELATED_OBJECTS FltObjects)
{
    UNREFERENCED_PARAMETER(FltObjects);

    LARGE_INTEGER ts;
    KeQuerySystemTimePrecise(&ts);
    hdr->MsgType   = msgType;
    hdr->Flags     = 0;
    hdr->ProcessId = (ULONG_PTR)FltGetRequestorProcessId(Data);
    hdr->Timestamp = ts.QuadPart;

    PFLT_FILE_NAME_INFORMATION nameInfo = NULL;
    if (NT_SUCCESS(FltGetFileNameInformation(Data,
            FLT_FILE_NAME_NORMALIZED | FLT_FILE_NAME_QUERY_DEFAULT, &nameInfo))) {
        FltParseFileNameInformation(nameInfo);
        SIZE_T chars = min((SIZE_T)(nameInfo->Name.Length / sizeof(WCHAR)),
                           (SIZE_T)(DLP_PATH_WCHARS - 1));
        RtlCopyMemory(hdr->FilePath, nameInfo->Name.Buffer, chars * sizeof(WCHAR));
        FltReleaseFileNameInformation(nameInfo);
    }
}

// Send a message to the service and optionally receive a verdict.
// Returns DLP_VERDICT_ALLOW on timeout, disconnect, or any error (fail-open).
//
// DLP_KERNEL_MESSAGE starts with FILTER_MESSAGE_HEADER, but FltSendMessage's
// SenderBuffer must NOT include it — FltMgr prepends its own copy automatically.
// Pass only the payload (union) part to FltSendMessage.
static ULONG SendMsg(PVOID  msgBuf,
                      ULONG  msgSize,
                      BOOLEAN needVerdict)
{
    if (!g_ClientPort) return DLP_VERDICT_ALLOW;

    // FltMgr strips FILTER_REPLY_HEADER before writing to the minifilter's ReplyBuffer —
    // only the DLP_REPLY payload arrives here. Use DLP_REPLY directly so Verdict is at
    // offset 0, matching what FltMgr writes. Using DLP_USER_REPLY would cause Verdict
    // to land in Header.Status (offset 0) while being read from Reply.Verdict (offset 12),
    // always returning 0 (ALLOW) regardless of the agent's actual decision.
    DLP_REPLY reply  = {};
    ULONG     repLen = sizeof(reply);

    // FltMgr prepends FILTER_MESSAGE_HEADER itself — send only the union payload.
    // Use offsetof to get the exact byte offset of the union in DLP_KERNEL_MESSAGE,
    // regardless of packing or sizeof(FILTER_MESSAGE_HEADER) on this platform.
    PVOID payload     = (PUCHAR)msgBuf + FIELD_OFFSET(DLP_KERNEL_MESSAGE, Generic);
    ULONG payloadSize = msgSize        - (ULONG)FIELD_OFFSET(DLP_KERNEL_MESSAGE, Generic);

    // 30 s for blocking writes (agent may be backlogged); near-zero for fire-and-forget
    LARGE_INTEGER timeout;
    timeout.QuadPart = needVerdict ? -300000000LL : -10000LL; // 30000ms or 1ms

    NTSTATUS status = FltSendMessage(g_Filter, &g_ClientPort,
                                      payload, payloadSize,
                                      needVerdict ? &reply : NULL,
                                      needVerdict ? &repLen : NULL,
                                      &timeout);

    // NT_SUCCESS(STATUS_TIMEOUT) == TRUE — must use exact STATUS_SUCCESS check
    // to avoid reading a zero-initialized reply buffer on timeout.
    if (needVerdict && status == STATUS_SUCCESS)
        return reply.Verdict;

    return DLP_VERDICT_ALLOW;
}

// Skip callbacks that originate from the service itself or kernel code.
static BOOLEAN ShouldSkip(PFLT_CALLBACK_DATA Data)
{
    if (Data->RequestorMode == KernelMode)                         return TRUE;
    if (IoThreadToProcess(Data->Thread) == g_ServiceProcess)       return TRUE;
    if (!g_ClientPort)                                              return TRUE;
    if (KeGetCurrentIrql() > APC_LEVEL)                            return TRUE;
    return FALSE;
}

// =========================================================================
// IRP_MJ_CREATE  — fire-and-forget file open notification
// =========================================================================
FLT_PREOP_CALLBACK_STATUS DlpPreCreate(PFLT_CALLBACK_DATA    Data,
                                         PCFLT_RELATED_OBJECTS FltObjects,
                                         PVOID*               CompletionContext)
{
    UNREFERENCED_PARAMETER(CompletionContext);
    if (ShouldSkip(Data)) return FLT_PREOP_SUCCESS_WITH_CALLBACK;

    DLP_KERNEL_MESSAGE msg = {};
    FillHeader(&msg.Generic, DLP_MSG_FILE_CREATE, Data, FltObjects);
    SendMsg(&msg, sizeof(msg), FALSE);

    return FLT_PREOP_SUCCESS_WITH_CALLBACK;
}

FLT_POSTOP_CALLBACK_STATUS DlpPostCreate(PFLT_CALLBACK_DATA    Data,
                                           PCFLT_RELATED_OBJECTS FltObjects,
                                           PVOID                 CompletionContext,
                                           FLT_POST_OPERATION_FLAGS Flags)
{
    UNREFERENCED_PARAMETER(Data);
    UNREFERENCED_PARAMETER(FltObjects);
    UNREFERENCED_PARAMETER(CompletionContext);
    UNREFERENCED_PARAMETER(Flags);
    return FLT_POSTOP_FINISHED_PROCESSING;
}

// =========================================================================
// IRP_MJ_WRITE  — blocking: inspect snippet, wait for verdict
// =========================================================================
FLT_PREOP_CALLBACK_STATUS DlpPreWrite(PFLT_CALLBACK_DATA    Data,
                                        PCFLT_RELATED_OBJECTS FltObjects,
                                        PVOID*               CompletionContext)
{
    UNREFERENCED_PARAMETER(CompletionContext);
    if (ShouldSkip(Data)) return FLT_PREOP_SUCCESS_NO_CALLBACK;

    // Fast pre-filters — avoid the expensive agent round-trip for writes that
    // cannot possibly contain DLP-relevant content.

    // 1. Too small: shortest pattern (SSN) needs 11 bytes; skip tiny writes.
    ULONG writeLength = Data->Iopb->Parameters.Write.Length;
    if (writeLength < 11) return FLT_PREOP_SUCCESS_NO_CALLBACK;

    DLP_KERNEL_MESSAGE msg = {};
    FillHeader(&msg.FileIo.Header, DLP_MSG_FILE_WRITE, Data, FltObjects);

    // 2. System path: Windows/ProgramFiles/ProgramData\Microsoft writes are
    //    high-frequency OS noise — they never hold user-generated sensitive data.
    if (IsSystemPath(msg.FileIo.Header.FilePath))
        return FLT_PREOP_SUCCESS_NO_CALLBACK;

    // Capture content snippet from the write buffer
    PVOID writeBuffer = NULL;

    if (Data->Iopb->Parameters.Write.MdlAddress) {
        writeBuffer = MmGetSystemAddressForMdlSafe(
            Data->Iopb->Parameters.Write.MdlAddress, NormalPagePriority);
    } else {
        writeBuffer = Data->Iopb->Parameters.Write.WriteBuffer;
    }

    if (writeBuffer && writeLength > 0) {
        ULONG snippetLen = min(writeLength, (ULONG)DLP_SNIPPET_BYTES);
        __try {
            RtlCopyMemory(msg.FileIo.Data, writeBuffer, snippetLen);
            msg.FileIo.DataLength = snippetLen;
        } __except (EXCEPTION_EXECUTE_HANDLER) {
            msg.FileIo.DataLength = 0;
        }
    }
    msg.FileIo.FileOffset = Data->Iopb->Parameters.Write.ByteOffset.LowPart;

    ULONG verdict = SendMsg(&msg, sizeof(msg), TRUE);
    if (verdict == DLP_VERDICT_BLOCK) {
        Data->IoStatus.Status      = STATUS_ACCESS_DENIED;
        Data->IoStatus.Information = 0;
        return FLT_PREOP_COMPLETE;
    }
    return FLT_PREOP_SUCCESS_NO_CALLBACK;
}

// =========================================================================
// IRP_MJ_READ (post) — observational: inspect content being read
// =========================================================================
FLT_POSTOP_CALLBACK_STATUS DlpPostRead(PFLT_CALLBACK_DATA    Data,
                                         PCFLT_RELATED_OBJECTS FltObjects,
                                         PVOID                 CompletionContext,
                                         FLT_POST_OPERATION_FLAGS Flags)
{
    UNREFERENCED_PARAMETER(CompletionContext);

    if (Flags & FLTFL_POST_OPERATION_DRAINING) return FLT_POSTOP_FINISHED_PROCESSING;
    if (ShouldSkip(Data))                       return FLT_POSTOP_FINISHED_PROCESSING;
    if (!NT_SUCCESS(Data->IoStatus.Status))     return FLT_POSTOP_FINISHED_PROCESSING;

    DLP_KERNEL_MESSAGE msg = {};
    FillHeader(&msg.FileIo.Header, DLP_MSG_FILE_READ, Data, FltObjects);

    PVOID readBuffer = NULL;
    ULONG readLength = (ULONG)Data->IoStatus.Information;

    if (Data->Iopb->Parameters.Read.MdlAddress) {
        readBuffer = MmGetSystemAddressForMdlSafe(
            Data->Iopb->Parameters.Read.MdlAddress, NormalPagePriority);
    } else {
        readBuffer = Data->Iopb->Parameters.Read.ReadBuffer;
    }

    if (readBuffer && readLength > 0) {
        ULONG snippetLen = min(readLength, (ULONG)DLP_SNIPPET_BYTES);
        __try {
            RtlCopyMemory(msg.FileIo.Data, readBuffer, snippetLen);
            msg.FileIo.DataLength = snippetLen;
        } __except (EXCEPTION_EXECUTE_HANDLER) {}
    }

    SendMsg(&msg, sizeof(msg), FALSE);
    return FLT_POSTOP_FINISHED_PROCESSING;
}

// =========================================================================
// IRP_MJ_SET_INFORMATION — rename and delete notifications
// =========================================================================
FLT_PREOP_CALLBACK_STATUS DlpPreSetInfo(PFLT_CALLBACK_DATA    Data,
                                          PCFLT_RELATED_OBJECTS FltObjects,
                                          PVOID*               CompletionContext)
{
    UNREFERENCED_PARAMETER(CompletionContext);
    if (ShouldSkip(Data)) return FLT_PREOP_SUCCESS_NO_CALLBACK;

    FILE_INFORMATION_CLASS cls =
        Data->Iopb->Parameters.SetFileInformation.FileInformationClass;

    ULONG msgType = 0;
    if (cls == FileDispositionInformation || cls == FileDispositionInformationEx)
        msgType = DLP_MSG_FILE_DELETE;
    else if (cls == FileRenameInformation || cls == FileRenameInformationEx)
        msgType = DLP_MSG_FILE_RENAME;
    else
        return FLT_PREOP_SUCCESS_NO_CALLBACK;

    DLP_KERNEL_MESSAGE msg = {};
    FillHeader(&msg.Generic, msgType, Data, FltObjects);
    SendMsg(&msg, sizeof(msg), FALSE);

    return FLT_PREOP_SUCCESS_NO_CALLBACK;
}
