// DLPFilter.cpp — Windows Minifilter Driver entry point
// Intercepts file I/O and process events, forwards to DLPService via
// a Filter Manager communication port for DLP policy enforcement.
//
// Build: VS 2022 + WDK 10.0.22621, Release x64
// ALWAYS test inside a VM with a snapshot before bare-metal deployment.
#include <fltKernel.h>
#include "../../common/DLPProtocol.h"

#ifndef PROCESS_TERMINATE
#define PROCESS_TERMINATE 0x0001
#endif

// ---- Forward declarations -----------------------------------------------
NTSTATUS DriverEntry(PDRIVER_OBJECT, PUNICODE_STRING);
NTSTATUS FilterUnload(FLT_FILTER_UNLOAD_FLAGS);
NTSTATUS InstanceSetup(PCFLT_RELATED_OBJECTS, FLT_INSTANCE_SETUP_FLAGS, DEVICE_TYPE, FLT_FILESYSTEM_TYPE);
NTSTATUS InstanceQueryTeardown(PCFLT_RELATED_OBJECTS, FLT_INSTANCE_QUERY_TEARDOWN_FLAGS);

NTSTATUS CommConnect(PFLT_PORT, PVOID, PVOID, ULONG, PVOID*);
VOID     CommDisconnect(PVOID);
NTSTATUS CommMessage(PVOID, PVOID, ULONG, PVOID, ULONG, PULONG);

extern FLT_PREOP_CALLBACK_STATUS  DlpPreCreate(PFLT_CALLBACK_DATA, PCFLT_RELATED_OBJECTS, PVOID*);
extern FLT_POSTOP_CALLBACK_STATUS DlpPostCreate(PFLT_CALLBACK_DATA, PCFLT_RELATED_OBJECTS, PVOID, FLT_POST_OPERATION_FLAGS);
extern FLT_PREOP_CALLBACK_STATUS  DlpPreWrite(PFLT_CALLBACK_DATA, PCFLT_RELATED_OBJECTS, PVOID*);
extern FLT_POSTOP_CALLBACK_STATUS DlpPostRead(PFLT_CALLBACK_DATA, PCFLT_RELATED_OBJECTS, PVOID, FLT_POST_OPERATION_FLAGS);
extern FLT_PREOP_CALLBACK_STATUS  DlpPreSetInfo(PFLT_CALLBACK_DATA, PCFLT_RELATED_OBJECTS, PVOID*);
extern VOID NTAPI OnProcessNotify(PEPROCESS, HANDLE, PPS_CREATE_NOTIFY_INFO);

// ---- Globals ------------------------------------------------------------
PFLT_FILTER  g_Filter        = NULL;
PFLT_PORT    g_ServerPort    = NULL;
PFLT_PORT    g_ClientPort    = NULL;
PEPROCESS    g_ServiceProcess = NULL;

// ---- Callback table -----------------------------------------------------
CONST FLT_OPERATION_REGISTRATION Callbacks[] = {
    { IRP_MJ_CREATE,          0, DlpPreCreate,  DlpPostCreate },
    { IRP_MJ_WRITE,           0, DlpPreWrite,   NULL          },
    { IRP_MJ_READ,            0, NULL,           DlpPostRead   },
    { IRP_MJ_SET_INFORMATION, 0, DlpPreSetInfo,  NULL          },
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
NTSTATUS DriverEntry(PDRIVER_OBJECT DriverObject, PUNICODE_STRING RegistryPath)
{
    UNREFERENCED_PARAMETER(RegistryPath);

    NTSTATUS           status;
    UNICODE_STRING     portName = RTL_CONSTANT_STRING(DLP_PORT_NAME);
    OBJECT_ATTRIBUTES  oa;
    PSECURITY_DESCRIPTOR sd = NULL;

    status = FltRegisterFilter(DriverObject, &FilterRegistration, &g_Filter);
    if (!NT_SUCCESS(status)) return status;

    // Create comm port — restrict to LocalSystem / admins
    status = FltBuildDefaultSecurityDescriptor(&sd, FLT_PORT_ALL_ACCESS);
    if (!NT_SUCCESS(status)) goto cleanup_filter;

    InitializeObjectAttributes(&oa, &portName,
                                OBJ_KERNEL_HANDLE | OBJ_CASE_INSENSITIVE,
                                NULL, sd);

    // Allow exactly one service connection
    status = FltCreateCommunicationPort(g_Filter, &g_ServerPort, &oa, NULL,
                                         CommConnect, CommDisconnect, CommMessage, 1);
    FltFreeSecurityDescriptor(sd);
    if (!NT_SUCCESS(status)) goto cleanup_filter;

    status = PsSetCreateProcessNotifyRoutineEx(OnProcessNotify, FALSE);
    if (!NT_SUCCESS(status)) goto cleanup_port;

    status = FltStartFiltering(g_Filter);
    if (!NT_SUCCESS(status)) {
        PsSetCreateProcessNotifyRoutineEx(OnProcessNotify, TRUE);
        goto cleanup_port;
    }

    KdPrint(("DLPFilter: loaded\n"));
    return STATUS_SUCCESS;

cleanup_port:
    FltCloseCommunicationPort(g_ServerPort);
cleanup_filter:
    FltUnregisterFilter(g_Filter);
    return status;
}

// =========================================================================
// FilterUnload
// =========================================================================
NTSTATUS FilterUnload(FLT_FILTER_UNLOAD_FLAGS Flags)
{
    UNREFERENCED_PARAMETER(Flags);
    PsSetCreateProcessNotifyRoutineEx(OnProcessNotify, TRUE);
    FltCloseCommunicationPort(g_ServerPort);
    FltUnregisterFilter(g_Filter);
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

NTSTATUS InstanceQueryTeardown(PCFLT_RELATED_OBJECTS          FltObjects,
                                FLT_INSTANCE_QUERY_TEARDOWN_FLAGS Flags)
{
    UNREFERENCED_PARAMETER(FltObjects);
    UNREFERENCED_PARAMETER(Flags);
    return STATUS_SUCCESS;
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

    g_ClientPort     = ClientPort;
    g_ServiceProcess = IoThreadToProcess(KeGetCurrentThread());
    KdPrint(("DLPFilter: service connected\n"));
    return STATUS_SUCCESS;
}

VOID CommDisconnect(PVOID ConnectionPortCookie)
{
    UNREFERENCED_PARAMETER(ConnectionPortCookie);
    FltCloseClientPort(g_Filter, &g_ClientPort);
    g_ClientPort     = NULL;
    g_ServiceProcess = NULL;
    KdPrint(("DLPFilter: service disconnected\n"));
}

// CommMessage handles action commands sent by the service (user → kernel).
NTSTATUS CommMessage(PVOID  PortCookie,
                      PVOID  InputBuffer,
                      ULONG  InputBufferLength,
                      PVOID  OutputBuffer,
                      ULONG  OutputBufferLength,
                      PULONG ReturnOutputBufferLength)
{
    UNREFERENCED_PARAMETER(PortCookie);
    UNREFERENCED_PARAMETER(OutputBuffer);
    UNREFERENCED_PARAMETER(OutputBufferLength);

    if (ReturnOutputBufferLength) *ReturnOutputBufferLength = 0;
    if (!InputBuffer || InputBufferLength < sizeof(DLP_ACTION_MSG))
        return STATUS_BUFFER_TOO_SMALL;

    DLP_ACTION_MSG* cmd = (DLP_ACTION_MSG*)InputBuffer;

    if (cmd->ActionType == DLP_ACTION_KILL_PID && cmd->TargetPid != 0) {
        PEPROCESS proc = NULL;
        if (NT_SUCCESS(PsLookupProcessByProcessId((HANDLE)cmd->TargetPid, &proc))) {
            HANDLE hProc = NULL;
            OBJECT_ATTRIBUTES oa;
            InitializeObjectAttributes(&oa, NULL, OBJ_KERNEL_HANDLE, NULL, NULL);
            if (NT_SUCCESS(ObOpenObjectByPointer(proc, OBJ_KERNEL_HANDLE, NULL,
                                                  PROCESS_TERMINATE, *PsProcessType,
                                                  KernelMode, &hProc))) {
                ZwTerminateProcess(hProc, (NTSTATUS)0xC0000001);
                ZwClose(hProc);
            }
            ObDereferenceObject(proc);
        }
    }

    return STATUS_SUCCESS;
}
