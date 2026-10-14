import request from '@cypress/request';
export default class Stream {
    static current = null;
    url;
    stream;
    constructor(url) {
        if (!Stream.current) {
            Stream.current = this;
            this.url = url;
            this.stream = request.get(this.url);
        }
        else {
            return Stream.current;
        }
    }
    getStream() {
        return this.stream;
    }
    setNewStream() {
        this.stream = null;
        this.stream = request.get(this.url);
    }
}
