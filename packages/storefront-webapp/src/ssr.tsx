/// <reference types="vinxi/types/server" />
import {
  createStartHandler,
  defaultStreamHandler,
} from "@tanstack/start/server";

export default createStartHandler(defaultStreamHandler);
