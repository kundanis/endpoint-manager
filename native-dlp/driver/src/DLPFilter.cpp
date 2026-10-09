// DLPFilter.cpp — Windows Minifilter Driver entry point
// Intercepts file writes and forwards them to DLPService via a Filter Manager
// communication port for DLP policy enforcement.
//
// Build: VS 2022 + WDK 10.0.22621, Release x64
// ALWAYS test inside a VM with a snapshot before bare-metal deployment.
//
// Hardening pass (see docs in native-dlp review):
//  - Only IRP_MJ_WRITE is filtered. Create/read/rename/delete/process notifications
//    used to be sent for every operation on the machine and were ignored by the service.
//  - The service→kernel "kill process" command was removed: terminating an arbitrary PID
//    through a kernel handle bypasses Protected Process Light, which would turn a signed
//    copy of this driver into a tool for killing AV/EDR (BYOVD).
//  - Only the real DLPService (LocalSystem, image DLPService.exe) may connect.
//  - Message buffers come from a non-paged lookaside list, never the kernel stack.
#include <fltKernel.h>
#include "../../common/DLPProtocol.h"

#define DLP_POOL_TAG 'pLDE'   // "EDLp" in pool dumps

// ---- Forward declarations -----------------------------------------------
extern "C" DRIVER_INITIALIZE DriverEntry;
NTSTATUS FilterUnload(FLT_FILTER_UNLOAD_FLAGS);
NTSTATUS InstanceSetup(PCFLT_RELATED_OBJECTS, FLT_INSTANCE_SETUP_FLAGS, DEVICE_TYPE, FLT_FILESYSTEM_TYPE);
NTSTATUS InstanceQueryTeardown(PCFLT_RELATED_OBJECTS, FLT_INSTANCE_QUERY_TEARDOWN_FLAGS);

NTSTATUS CommConnect(PFLT_PORT, PVOID, PVOID, ULONG, PVOID*);
VOID     CommDisconnect(PVOID);
NTSTATUS CommMessage(PVOID, PVOID, ULONG, PVOID, ULONG, PULONG);

extern FLT_PREOP_CALLBACK_STATUS DlpPreWrite(PFLT_CALLBACK_DATA, PCFLT_RELATED_OBJECTS, PVOID*);

// ---- Globals ------------------------------------------------------------
PFLT_FILTER            g_Filter     = NULL;
PFLT_PORT              g_ServerPort = NULL;
PFLT_PORT              g_ClientPort = NULL;
// PID of the connected service — compared against each request's requestor PID so the
// service's own I/O is never routed back to itself. A PID rather than an unreferenced
// PEPROCESS pointer, which could be freed and reused after the service exits.
volatile ULONG_PTR     g_ServicePid = 0;
NPAGED_LOOKASIDE_LIST  g_MsgLookaside;
static BOOLEAN         g_LookasideReady = FALSE;

// ---- Callback table -----------------------------------------------------
CONST FLT_OPERATION_REGISTRATION Callbacks[] = {
    { IRP_MJ_WRITE, 0, DlpPreWrite, NULL },
    { IRP_MJ_OPERATION_END }
};

CONST FLT_REGISTRATION FilterRegistration = {
    sizeof(FLT_REGISTRATION),
    FLT_REGISTRATION_VERSION,
    0,
    NULL,          // context registration
    Callbacks,
    FilterUnload,
    InstanceSetup,
    InstanceQueryTeardown,
    NULL, NULL, NULL, NULL, NULL, NULL
};

// =========================================================================
// DriverEntry
// =========================================================================
extern "C" NTSTATUS DriverEntry(PDRIVER_OBJECT DriverObject, PUNICODE_STRING RegistryPath)
{
    UNREFERENCED_PARAMETER(RegistryPath);

    NTSTATUS             status;
    UNICODE_STRING       portName = RTL_CONSTANT_STRING(DLP_PORT_NAME);
    OBJECT_ATTRIBUTES    oa;
    PSECURITY_DESCRIPTOR sd = NULL;

    // Fixed-size, non-paged, no-execute buffers for kernel→service messages
    // (DLP_KERNEL_MESSAGE is ~6 KB — far too large for the 24 KB kernel stack, which
    // file-system callbacks share with every filter and file system below them).
    ExInitializeNPagedLookasideList(&g_MsgLookaside, NULL, NULL, POOL_NX_ALLOCATION,
                                    sizeof(DLP_KERNEL_MESSAGE), DLP_POOL_TAG, 0);
    g_LookasideReady = TRUE;

    status = FltRegisterFilter(DriverObject, &FilterRegistration, &g_Filter);
    if (!NT_SUCCESS(status)) goto cleanup_lookaside;

    // Comm port DACL: LocalSystem + Administrators only. CommConnect then narrows it
    // further to the DLPService process itself.
    status = FltBuildDefaultSecurityDescriptor(&sd, FLT_PORT_ALL_ACCESS);
    if (!NT_SUCCESS(status)) goto cleanup_filter;

    InitializeObjectAttributes(&oa, &portName, OBJ_KERNEL_HANDLE | OBJ_CASE_INSENSITIVE, NULL, sd);

    // Allow exactly one service connection
    status = FltCreateCommunicationPort(g_Filter, &g_ServerPort, &oa, NULL,
                                        CommConnect, CommDisconnect, CommMessage, 1);
    FltFreeSecurityDescriptor(sd);
    if (!NT_SUCCESS(status)) goto cleanup_filter;

    status = FltStartFiltering(g_Filter);
    if (!NT_SUCCESS(status)) goto cleanup_port;

    KdPrint(("DLPFilter: loaded\n"));
    return STATUS_SUCCESS;

cleanup_port:
    FltCloseCommunicationPort(g_ServerPort);
cleanup_filter:
    FltUnregisterFilter(g_Filter);
cleanup_lookaside:
    ExDeleteNPagedLookasideList(&g_MsgLookaside);
    g_LookasideReady = FALSE;
    return status;
}

// =========================================================================
// FilterUnload
// =========================================================================
NTSTATUS FilterUnload(FLT_FILTER_UNLOAD_FLAGS Flags)
{
    UNREFERENCED_PARAMETER(Flags);
    FltCloseCommunicationPort(g_ServerPort);
    // FltUnregisterFilter waits for every in-flight callback to finish, so nothing can
    // still be holding a lookaside buffer once it returns.
    FltUnregisterFilter(g_Filter);
    if (g_LookasideReady) {
        ExDeleteNPagedLookasideList(&g_MsgLookaside);
        g_LookasideReady = FALSE;
    }
    KdPrint(("DLPFilter: unloaded\n"));
    return STATUS_SUCCESS;
}

// =========================================================================
// InstanceSetup — attach to all standard (non-raw) file systems
// =========================================================================
NTSTATUS InstanceSetup(PCFLT_RELATED_OBJECTS    FltObjects,
                       FLT_INSTANCE_SETUP_FLAGS Flags,
                       DEVICE_TYPE              VolumeDeviceType,
                       FLT_FILESYSTEM_TYPE      VolumeFilesystemType)
{
    UNREFERENCED_PARAMETER(FltObjects);
    UNREFERENCED_PARAMETER(Flags);
    UNREFERENCED_PARAMETER(VolumeDeviceType);

    if (VolumeFilesystemType == FLT_FSTYPE_RAW)
        return STATUS_FLT_DO_NOT_ATTACH;

    return STATUS_SUCCESS;
}

NTSTATUS InstanceQueryTeardown(PCFLT_RELATED_OBJECTS             FltObjects,
                               FLT_INSTANCE_QUERY_TEARDOWN_FLAGS Flags)
{
    UNREFERENCED_PARAMETER(FltObjects);
    UNREFERENCED_PARAMETER(Flags);
    return STATUS_SUCCESS;
}

// =========================================================================
// Connecting-process check
// =========================================================================

// TRUE only for a LocalSystem process whose image is ...\DLPService.exe. The port's DACL
// already limits connections to SYSTEM/Administrators; this stops an arbitrary admin tool
// from taking the single connection slot and answering verdicts (blocking every write, or
// allowing everything) while the real service is down. Runs in the connecting process's
// context at PASSIVE_LEVEL, which is what CommConnect is called in.
static BOOLEAN IsTrustedServiceProcess()
{
    PEPROCESS process = PsGetCurrentProcess();
    BOOLEAN   isSystem = FALSE;

    PACCESS_TOKEN token = PsReferencePrimaryToken(process);
    if (token) {
        PTOKEN_USER user = NULL;
        if (NT_SUCCESS(SeQueryInformationToken(token, TokenUser, (PVOID*)&user)) && user) {
            SID_IDENTIFIER_AUTHORITY ntAuthority = SECURITY_NT_AUTHORITY;
            UCHAR sidBuffer[SECURITY_MAX_SID_SIZE] = {};
            PSID  localSystem = (PSID)sidBuffer;
            if (NT_SUCCESS(RtlInitializeSid(localSystem, &ntAuthority, 1))) {
                *RtlSubAuthoritySid(localSystem, 0) = SECURITY_LOCAL_SYSTEM_RID;
                isSystem = RtlEqualSid(user->User.Sid, localSystem);
            }
            ExFreePool(user);
        }
        PsDereferencePrimaryToken(token);
    }
    if (!isSystem) return FALSE;

    PUNICODE_STRING imageName = NULL;
    if (!NT_SUCCESS(SeLocateProcessImageName(process, &imageName)) || !imageName) return FALSE;

    BOOLEAN        nameMatches = FALSE;
    UNICODE_STRING expected    = RTL_CONSTANT_STRING(L"\\DLPService.exe");
    if (imageName->Length >= expected.Length) {
        UNICODE_STRING tail;
        tail.Buffer        = (PWCH)((PUCHAR)imageName->Buffer + imageName->Length - expected.Length);
        tail.Length        = expected.Length;
        tail.MaximumLength = expected.Length;
        nameMatches = RtlEqualUnicodeString(&tail, &expected, TRUE);
    }
    ExFreePool(imageName);
    return nameMatches;
}

// =========================================================================
// Communication port — one service connection at a time
// =========================================================================
NTSTATUS CommConnect(PFLT_PORT ClientPort, PVOID ServerPortCookie,
                     PVOID ConnectionContext, ULONG SizeOfContext,
                     PVOID* ConnectionPortCookie)
{
    UNREFERENCED_PARAMETER(ServerPortCookie);
    UNREFERENCED_PARAMETER(ConnectionContext);
    UNREFERENCED_PARAMETER(SizeOfContext);
    UNREFERENCED_PARAMETER(ConnectionPortCookie);

    if (!IsTrustedServiceProcess()) {
        KdPrint(("DLPFilter: rejected connection from untrusted process %p\n", PsGetCurrentProcessId()));
        return STATUS_ACCESS_DENIED;
    }

    g_ServicePid = (ULONG_PTR)PsGetCurrentProcessId();
    g_ClientPort = ClientPort;
    KdPrint(("DLPFilter: service connected\n"));
    return STATUS_SUCCESS;
}

VOID CommDisconnect(PVOID ConnectionPortCookie)
{
    UNREFERENCED_PARAMETER(ConnectionPortCookie);
    FltCloseClientPort(g_Filter, &g_ClientPort);
    g_ClientPort = NULL;
    g_ServicePid = 0;
    KdPrint(("DLPFilter: service disconnected\n"));
}

// No service→kernel commands are accepted. The only one that ever existed (terminate a
// PID) was removed — see the file header. The input buffer is a raw user-mode address
// and is deliberately never touched.
NTSTATUS CommMessage(PVOID  PortCookie,
                     PVOID  InputBuffer,
                     ULONG  InputBufferLength,
                     PVOID  OutputBuffer,
                     ULONG  OutputBufferLength,
                     PULONG ReturnOutputBufferLength)
{
    UNREFERENCED_PARAMETER(PortCookie);
    UNREFERENCED_PARAMETER(InputBuffer);
    UNREFERENCED_PARAMETER(InputBufferLength);
    UNREFERENCED_PARAMETER(OutputBuffer);
    UNREFERENCED_PARAMETER(OutputBufferLength);

    if (ReturnOutputBufferLength) *ReturnOutputBufferLength = 0;
    return STATUS_NOT_SUPPORTED;
}
