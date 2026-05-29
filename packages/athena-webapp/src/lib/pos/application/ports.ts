import type {
  PosAddItemInput,
  PosAddItemResultDto,
  PosBarcodeLookupInput,
  PosCatalogItemDto,
  PosCompleteTransactionInput,
  PosCompleteTransactionResultDto,
  PosHoldSessionInput,
  PosHoldSessionResultDto,
  PosOpenDrawerInput,
  PosOpenDrawerResultDto,
  PosProductIdLookupInput,
  PosProductSearchInput,
  PosRegisterCatalogAvailabilityInput,
  PosRegisterCatalogAvailabilityRowDto,
  PosRegisterCatalogInput,
  PosRegisterCatalogRowDto,
  PosRegisterStateDto,
  PosRegisterStateQueryInput,
  PosRegisteredTerminalDto,
  PosServiceCatalogRowDto,
  PosStartSessionInput,
  PosStartSessionResultDto,
  PosTerminalLookupInput,
} from "./dto";

export interface PosRegisterReader {
  useRegisterState(
    input: PosRegisterStateQueryInput,
  ): PosRegisterStateDto | undefined;
  useTerminal(
    input: PosTerminalLookupInput,
  ): PosRegisteredTerminalDto | null | undefined;
}

export interface PosCatalogReader {
  useRegisterCatalog(
    input: PosRegisterCatalogInput,
  ): PosRegisterCatalogRowDto[] | undefined;
  useRegisterServiceCatalog(
    input: PosRegisterCatalogInput,
  ): PosServiceCatalogRowDto[] | undefined;
  useRegisterCatalogAvailability(
    input: PosRegisterCatalogAvailabilityInput,
  ): PosRegisterCatalogAvailabilityRowDto[] | undefined;
  useProductSearch(
    input: PosProductSearchInput,
  ): PosCatalogItemDto[] | undefined;
  useBarcodeLookup(
    input: PosBarcodeLookupInput,
  ): PosCatalogItemDto | PosCatalogItemDto[] | null | undefined;
  useProductIdLookup(
    input: PosProductIdLookupInput,
  ): PosCatalogItemDto[] | undefined;
}

export interface PosCommandGateway {
  startSession(input: PosStartSessionInput): Promise<PosStartSessionResultDto>;
  addItem(input: PosAddItemInput): Promise<PosAddItemResultDto>;
  holdSession(input: PosHoldSessionInput): Promise<PosHoldSessionResultDto>;
  openDrawer(input: PosOpenDrawerInput): Promise<PosOpenDrawerResultDto>;
  completeTransaction(
    input: PosCompleteTransactionInput,
  ): Promise<PosCompleteTransactionResultDto>;
}

export interface PosTelemetryGateway {
  debug(message: string, metadata?: unknown): void;
  info(message: string, metadata?: unknown): void;
  warn(message: string, metadata?: unknown): void;
  error(message: string, metadata?: unknown): void;
}
