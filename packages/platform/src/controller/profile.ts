import XboxApiClient from 'xbox-webapi'
import { WebToken } from '../types/webtoken'

export default class profileController {

    async getCurrentProfile(token:WebToken) {
        const apiClient = new ((XboxApiClient as any) as { default: typeof XboxApiClient }).default({
            uhs: token.uhs,
            token: token.token
        })

        return await apiClient.providers['profile'].getCurrentUser()
    }

    async getFriendsList(_token:WebToken) {
        // Friends API disabled: do not call peoplehub.xboxlive.com.
        // Return a typed empty payload matching the people provider shape.
        return {
            data: {
                people: [],
            },
        }
    }
}