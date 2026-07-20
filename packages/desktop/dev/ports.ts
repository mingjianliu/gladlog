/** dev:ui 测试台的端口。
 *
 *  谓词单源:vite 配置里实际起服务的端口(dev server 与 preview)、
 *  Playwright 的 webServer.url 与 baseURL,全部从这里取。
 *  任何一处写死字面量,改端口时就会漏掉它。 */
export const VISUAL_PORT = 5199;
