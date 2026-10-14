import request from '@cypress/request'

export default class Stream {
  private static current: Stream | null = null
  private url!: string
  private stream!: request.Request | null

  constructor(url: string) {
    if (!Stream.current) {
      Stream.current = this
      this.url = url
      this.stream = request.get(this.url)
    }
    else {
      return Stream.current
    }
  }

  getStream(): request.Request | null {
    return this.stream
  }

  setNewStream(): void {
    this.stream = null
    this.stream = request.get(this.url)
  }
}
