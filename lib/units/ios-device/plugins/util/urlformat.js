export default function urlformat(template, port) {
    return template.replace('${publicPort}', String(port));
}
