import type { CustomerPhoneNumbersPage } from "@workspace/api-client-react";

const PAGE_SIZE = 200;
const MAX_PAGES = 10_000;

export async function fetchAllCustomerPhoneNumbers(
  loadPage: (params: { limit: number; offset: number }) => Promise<CustomerPhoneNumbersPage>,
  onProgress?: (loaded: number, total: number) => void,
): Promise<{ phones: string[]; total: number }> {
  const phones: string[] = [];
  let offset = 0;
  let total = 0;

  for (let pageNumber = 0; pageNumber < MAX_PAGES; pageNumber += 1) {
    const page = await loadPage({ limit: PAGE_SIZE, offset });
    if (!Array.isArray(page.phones) || !Number.isSafeInteger(page.total) || page.total < 0) {
      throw new Error("The customer phone-number response was invalid.");
    }
    total = page.total;
    phones.push(...page.phones.filter((phone) => typeof phone === "string" && phone.trim()));
    onProgress?.(phones.length, total);

    if (page.next_offset === null) return { phones, total };
    if (!Number.isSafeInteger(page.next_offset) || page.next_offset <= offset) {
      throw new Error("The customer phone-number pagination did not advance.");
    }
    offset = page.next_offset;
  }

  throw new Error("The customer phone-number list exceeded the supported page count.");
}
