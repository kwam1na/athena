import type {
  PosAddItemInput,
  PosAddItemResultDto,
  PosBarcodeLookupInput,
  PosCatalogItemDto,
  PosCompleteTransactionInput,
  PosCompleteTransactionResultDto,
  PosHoldSessionInput,
  PosHoldSessionResultDto,
  PosProductIdLookupInput,
  PosProductSearchInput,
  PosRegisterStateDto,
  PosRegisterStateQueryInput,
  PosRegisteredTerminalDto,
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
