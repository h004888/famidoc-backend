export interface PlatformLegalIdentity {
  companyName: string;
  taxCode: string;
  address: string;
  representative: string;
  supportContact: string;
}

export interface PlatformAdminSignerLike {
  fullName?: string | null;
  email?: string | null;
}

/**
 * Resolve Platform (FamiDoc) legal entity metadata from shared FAMIDOC_LEGAL_*
 * environment variables with deterministic fallbacks so B2B and 4-party contracts
 * present identical legal identification.
 */
export function resolvePlatformLegalIdentity(
  admin?: PlatformAdminSignerLike | null,
): PlatformLegalIdentity {
  return {
    companyName:
      process.env.FAMIDOC_LEGAL_COMPANY_NAME?.trim() ||
      'Nền tảng Y tế Gia đình FamiDoc',
    taxCode: process.env.FAMIDOC_LEGAL_TAX_CODE?.trim() || '0109998888',
    address:
      process.env.FAMIDOC_LEGAL_ADDRESS?.trim() ||
      'Việt Nam (Vận hành trực tuyến tại https://famidoc.online)',
    representative:
      process.env.FAMIDOC_LEGAL_REPRESENTATIVE?.trim() ||
      admin?.fullName?.trim() ||
      'Ban Quản trị Nền tảng FamiDoc',
    supportContact:
      process.env.FAMIDOC_LEGAL_SUPPORT_CONTACT?.trim() ||
      admin?.email?.trim() ||
      'support@famidoc.online',
  };
}
