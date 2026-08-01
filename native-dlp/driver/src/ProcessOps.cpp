// ProcessOps.cpp — Process creation/termination notifications
#include <fltKernel.h>
#include "../../common/DLPProtocol.h"

extern PFLT_FILTER g_Filter;
extern PFLT_PORT   g_ClientPort;

VOID NTAPI OnProcessNotify(PEPROCESS            Process,
                             HANDLE               ProcessId,
                             PPS_CREATE_NOTIFY_INFO CreateInfo)
{
    UNREFERENCED_PARAMETER(Process);

    if (!g_ClientPort) return;

    DLP_KERNEL_MESSAGE msg = {};
    LARGE_INTEGER ts;
    KeQuerySystemTimePrecise(&ts);

    msg.Process.Header.MsgType    = CreateInfo ? DLP_MSG_PROCESS_CREATE : DLP_MSG_PROCESS_TERM;
    msg.Process.Header.ProcessId  = (ULONG_PTR)ProcessId;
    msg.Process.Header.Timestamp  = ts.QuadPart;

    if (CreateInfo) {
        msg.Process.Header.ParentPid = (ULONG_PTR)CreateInfo->ParentProcessId;

        if (CreateInfo->ImageFileName) {
            SIZE_T chars = min(
                (SIZE_T)(CreateInfo->ImageFileName->Length / sizeof(WCHAR)),
                (SIZE_T)(DLP_PATH_WCHARS - 1));
            RtlCopyMemory(msg.Process.Header.ProcessPath,
                           CreateInfo->ImageFileName->Buffer,
                           chars * sizeof(WCHAR));
        }

        if (CreateInfo->CommandLine) {
            SIZE_T chars = min(
                (SIZE_T)(CreateInfo->CommandLine->Length / sizeof(WCHAR)),
                (SIZE_T)(DLP_PATH_WCHARS * 2 - 1));
            RtlCopyMemory(msg.Process.CommandLine,
                           CreateInfo->CommandLine->Buffer,
                           chars * sizeof(WCHAR));
        }
    }

    // Fire-and-forget: 1ms timeout, no reply
    LARGE_INTEGER timeout;
    timeout.QuadPart = -10000LL;
    FltSendMessage(g_Filter, &g_ClientPort, &msg, sizeof(msg), NULL, NULL, &timeout);
}
