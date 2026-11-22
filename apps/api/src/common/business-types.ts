/** The kinds of business a company can be. Only TEA_SHOP has its own look in the apps; the others share the standard one. */
export const BUSINESS_TYPES = ['TEA_SHOP', 'HOTEL', 'RESTAURANT', 'BAKERY', 'FRUIT_STALL', 'VEGETABLE_SHOP', 'GROCERY', 'OTHER'] as const;

/** Where the apps fetch a company's frame picture; the version changes whenever it is replaced, so it caches for good. */
export const frameUrl = (companyId: string, updatedAt: Date) => `/api/v1/branding/${companyId}/frame?v=${updatedAt.getTime()}`;

/** The typefaces and text sizes a company can pick for its app (Super Admin, on the company form). */
export const BUSINESS_FONTS = ['INTER', 'POPPINS', 'NUNITO', 'ROBOTO', 'LORA'] as const;
export const BUSINESS_FONT_SIZES = ['SMALL', 'MEDIUM', 'LARGE', 'XLARGE'] as const;
