#pragma once

// Shared between kernel minifilter (DLPFilter.sys) and userspace service (DLPService.exe).
// Both sides must compile with identical packing and type widths.

#ifdef _KERNEL_MODE
  #include <fltKernel.h>
#else
  #include <windows.h>
  #include <fltUser.h>
#endif

// ---- Message types (kernel → service) -----------------------------------
#define DLP_MSG_FILE_CREATE      1
#define DLP_MSG_FILE_READ        2
#define DLP_MSG_FILE_WRITE       3
#define DLP_MSG_FILE_RENAME      4
#define DLP_MSG_FILE_DELETE      5
#define DLP_MSG_PROCESS_CREATE   6
#define DLP_MSG_PROCESS_TERM     7

// ---- Action types (service → kernel via FilterSendMessage) ---------------
#define DLP_ACTION_KILL_PID      1
#define DLP_ACTION_QUARANTINE    2   // handled in userspace; kernel ACKs only

// ---- Verdicts (carried in reply to blocking pre-op events) ---------------
#define DLP_VERDICT_ALLOW        0
#define DLP_VERDICT_BLOCK        1

// ---- Communication port name ---------------------------------------------
#define DLP_PORT_NAME            L"\\DLPFilterPort"

// ---- Buffer dimensions ---------------------------------------------------
#define DLP_SNIPPET_BYTES        4096   // max content bytes sent with IO events
#define DLP_PATH_WCHARS          512    // including NUL

// =========================================================================
// Common header carried by every kernel→service message
// =========================================================================
#pragma pack(push, 1)

typedef struct _DLP_MSG_HEADER {
    ULONG     MsgType;
    ULONG     Flags;
    ULONG_PTR ProcessId;
    ULONG_PTR ParentPid;
    LONGLONG  Timestamp;                    // 100-ns ticks since 1601
    WCHAR     ProcessPath[DLP_PATH_WCHARS]; // image path of the requesting process
    WCHAR     FilePath[DLP_PATH_WCHARS];    // target file path
} DLP_MSG_HEADER;

// File read / write message — includes a content snippet
typedef struct _DLP_MSG_FILE_IO {
    DLP_MSG_HEADER Header;
    ULONG          DataLength;              // valid bytes in Data[]
    ULONG          FileOffset;             // low 32-bits of file offset
    UCHAR          Data[DLP_SNIPPET_BYTES];
} DLP_MSG_FILE_IO;

// Process create/terminate message
typedef struct _DLP_MSG_PROCESS {
    DLP_MSG_HEADER Header;
    WCHAR          CommandLine[DLP_PATH_WCHARS * 2];
} DLP_MSG_PROCESS;

// Verdict reply from service → filter (for blocking decisions)
typedef struct _DLP_REPLY {
    ULONG Verdict;      // DLP_VERDICT_*
    WCHAR Reason[128];
} DLP_REPLY;

// =========================================================================
// Wire wrappers (add FILTER_MESSAGE_HEADER / FILTER_REPLY_HEADER)
// =========================================================================

// Kernel → service: one message per event
typedef struct _DLP_KERNEL_MESSAGE {
    FILTER_MESSAGE_HEADER Header;   // filled by FltSendMessage / FilterGetMessage
    union {
        DLP_MSG_HEADER  Generic;
        DLP_MSG_FILE_IO FileIo;
        DLP_MSG_PROCESS Process;
    };
} DLP_KERNEL_MESSAGE;

// Service → filter: reply to a blocking event
typedef struct _DLP_USER_REPLY {
    FILTER_REPLY_HEADER Header;     // MessageId must echo the request
    DLP_REPLY           Reply;
} DLP_USER_REPLY;

// Service → kernel: unsolicited action command via FilterSendMessage
typedef struct _DLP_ACTION_MSG {
    ULONG     ActionType;           // DLP_ACTION_*
    ULONG_PTR TargetPid;
    WCHAR     FilePath[DLP_PATH_WCHARS];
} DLP_ACTION_MSG;

#pragma pack(pop)
