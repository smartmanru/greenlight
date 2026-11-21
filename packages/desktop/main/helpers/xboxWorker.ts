import Application from '../application'

/**
 * xboxWorker historically polled Xbox Friends.
 * Friends API traffic is fully disabled: no timers, no network calls.
 * The class is retained so authenticationCompleted and IPC continue to work.
 */
export default class xboxWorker {

    _application:Application

    _friends: Record<string, never> = {}
    _onlineFriends: any[] = []

    constructor(application: Application){
        this._application = application
        // Friends polling intentionally disabled (NoFriends build).
    }

    intervalFriends(){
        // No-op: Friends API disabled.
    }

    updateFriends(){
        return Promise.resolve(this._friends)
    }

}
