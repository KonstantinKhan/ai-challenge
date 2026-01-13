export class Error {
    private _message: string = "";

    constructor() {;
    }
    
    public get message(): string {
        return this._message;
    }

    public set message(value: string) {
        this._message = value;
    }

    clear(): Error {
        this.message = "";
        return this;
    }


    isProblem(): boolean {
        return this.message !== "";
    }
}