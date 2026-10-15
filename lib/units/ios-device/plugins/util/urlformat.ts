export default function urlformat(template: string, port: number): string {
  return template.replace('${publicPort}', String(port))
}
