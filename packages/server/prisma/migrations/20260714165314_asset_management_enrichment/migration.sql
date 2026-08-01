BEGIN TRY

BEGIN TRAN;

-- AlterTable
ALTER TABLE [dbo].[Agent] ADD [purchaseDate] DATETIME2,
[serialNumber] NVARCHAR(100),
[vendor] NVARCHAR(100),
[warrantyExpiryDate] DATETIME2;

-- AlterTable
ALTER TABLE [dbo].[InventorySnapshot] ADD [cpuPhysicalCores] INT,
[cpuSpeedGhz] FLOAT(53),
[diskVolumes] NVARCHAR(max) NOT NULL CONSTRAINT [InventorySnapshot_diskVolumes_df] DEFAULT '[]',
[memLayout] NVARCHAR(max) NOT NULL CONSTRAINT [InventorySnapshot_memLayout_df] DEFAULT '[]',
[osBuild] NVARCHAR(50),
[osLicenseChannel] NVARCHAR(50),
[osLicenseStatus] NVARCHAR(30),
[osPartialProductKey] NVARCHAR(20);

-- CreateTable
CREATE TABLE [dbo].[SoftwareLicense] (
    [id] NVARCHAR(1000) NOT NULL,
    [softwareName] NVARCHAR(300) NOT NULL,
    [vendor] NVARCHAR(200),
    [licenseKey] NVARCHAR(500),
    [licenseType] NVARCHAR(30) NOT NULL,
    [seatsPurchased] INT NOT NULL,
    [purchaseDate] DATETIME2,
    [expiryDate] DATETIME2,
    [cost] FLOAT(53),
    [notes] NVARCHAR(2000),
    [createdByAdminId] NVARCHAR(1000) NOT NULL,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [SoftwareLicense_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [SoftwareLicense_pkey] PRIMARY KEY CLUSTERED ([id])
);

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH
