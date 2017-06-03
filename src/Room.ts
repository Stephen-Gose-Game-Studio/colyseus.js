import { Signal } from "signals.js";
import Clock = require("clock.js");

import { DeltaContainer } from "delta-listener";
import * as msgpack from "msgpack-lite";
import * as fossilDelta from "fossil-delta";

import { Protocol } from "./Protocol";
import { Client } from "./Client";
import { Connection } from "./Connection";

export class Room<T=any> {
    public id: number;
    public name: string;

    public state: DeltaContainer<T & any> = new DeltaContainer<T & any>({});

    public clock: Clock = new Clock();
    public remoteClock: Clock = new Clock();

    // Public signals
    public onJoin: Signal = new Signal();
    public onUpdate: Signal = new Signal();
    public onData: Signal = new Signal();
    public onError: Signal = new Signal();
    public onLeave: Signal = new Signal();

    public ping: number;
    private lastPatchTime: number;

    public connection: Connection;
    private _previousState: any;

    constructor (name: string) {
        this.id = null;
        this.name = name;
        this.onLeave.add( this.removeAllListeners );
    }

    connect (connection: Connection) {
        this.connection = connection;
        this.connection.onmessage = this.onMessageCallback.bind(this);
        this.connection.onopen = (e) => this.onJoin.dispatch();
        this.connection.onclose = (e) => this.onLeave.dispatch();
    }

    protected onMessageCallback (event) {
        let message = msgpack.decode( new Uint8Array(event.data) );
        let code = message[0];

        if (code == Protocol.JOIN_ERROR) {
            this.onError.dispatch(message[2]);

        } else if (code == Protocol.ROOM_STATE) {
            let state = message[2];
            let remoteCurrentTime = message[3];
            let remoteElapsedTime = message[4];

            this.setState( state, remoteCurrentTime, remoteElapsedTime );

        } else if (code == Protocol.ROOM_STATE_PATCH) {
            this.patch( message[2] );

        } else if (code == Protocol.ROOM_DATA) {
            this.onData.dispatch(message[2]);

        } else if (code == Protocol.LEAVE_ROOM) {
            this.leave();
        }
    }

    setState ( state: T, remoteCurrentTime?: number, remoteElapsedTime?: number ): void {
        this.state.set(state);
        this._previousState = msgpack.encode( state )

        // set remote clock properties
        if (remoteCurrentTime && remoteElapsedTime) {
            this.remoteClock.currentTime = remoteCurrentTime
            this.remoteClock.elapsedTime = remoteElapsedTime
        }

        this.clock.start();

        this.onUpdate.dispatch(state);
    }

    patch ( binaryPatch ) {
        //
        // calculate client-side ping
        //
        let patchTime = Date.now();

        if ( this.lastPatchTime ) {
            this.ping = patchTime - this.lastPatchTime;
        }

        this.lastPatchTime = patchTime;

        this.clock.tick();

        // apply patch
        this._previousState = fossilDelta.apply( this._previousState, binaryPatch );

        // trigger state callbacks
        this.state.set( msgpack.decode( this._previousState ) );

        this.onUpdate.dispatch(this.state.data);
    }

    public leave (): void {
        if (this.id) {
            this.connection.close();
            // this.connection.send([ Protocol.LEAVE_ROOM, this.id ]);
        }
    }

    public send (data): void {
        if (this.connection.readyState === WebSocket.OPEN) {
            this.connection.send([ Protocol.ROOM_DATA, this.id, data ]);
        } else {
            console.warn("Room", this.id, "is not connected.");
        }
    }

    public removeAllListeners = (): void => {
        this.onJoin.removeAll();
        this.onUpdate.removeAll();
        this.onData.removeAll();
        this.onError.removeAll();
        this.onLeave.removeAll();
        this.state.removeAllListeners();
    }

}
